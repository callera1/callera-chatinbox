const http = require('http');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const APP_TITLE = process.env.APP_TITLE || 'Callera Conversations';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${APP_TITLE}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💬</text></svg>">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; }
    .scrollbar-thin::-webkit-scrollbar { width: 6px; }
    .scrollbar-thin::-webkit-scrollbar-track { background: #1f2937; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 3px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    window.CONFIG = {
      SUPABASE_URL: "${SUPABASE_URL}",
      SUPABASE_KEY: "${SUPABASE_KEY}",
      APP_TITLE: "${APP_TITLE}",
      AUTO_REFRESH_SECONDS: 30
    };
  </script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  
  <script type="text/babel">
    const { useState, useEffect, useRef, useCallback } = React;
    const CONFIG = window.CONFIG;

    function App() {
      const [conversations, setConversations] = useState({});
      const [selectedPhone, setSelectedPhone] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [lastRefresh, setLastRefresh] = useState(null);
      const [searchTerm, setSearchTerm] = useState('');
      const [mobileShowChat, setMobileShowChat] = useState(false);
      const [isInitialLoad, setIsInitialLoad] = useState(true);
      
      const messagesEndRef = useRef(null);
      const messagesContainerRef = useRef(null);
      const prevMessageCountRef = useRef({});

      const fetchMessages = useCallback(async () => {
        if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
          setError('Supabase credentials not configured');
          setLoading(false);
          return;
        }
        
        try {
          // Query n8n_chat_histories table - ordered by id (serial)
          const response = await fetch(
            CONFIG.SUPABASE_URL + '/rest/v1/n8n_chat_histories?select=id,session_id,message&order=id.asc',
            {
              headers: {
                'apikey': CONFIG.SUPABASE_KEY,
                'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY,
              },
            }
          );
          
          if (!response.ok) {
            throw new Error('Failed to fetch messages: ' + response.status);
          }
          
          const data = await response.json();
          
          // Group by session_id (phone number)
          const grouped = data.reduce((acc, row) => {
            const phone = row.session_id || 'Unknown';
            if (!acc[phone]) {
              acc[phone] = { messages: [], lastMessageId: 0 };
            }
            
            // Parse the JSONB message field
            const msg = row.message || {};
            acc[phone].messages.push({
              id: row.id,
              type: msg.type || 'unknown',  // 'human' or 'ai'
              content: msg.content || '[No content]',
            });
            acc[phone].lastMessageId = row.id;
            
            return acc;
          }, {});
          
          // Sort phones by last message id (most recent first)
          const sortedPhones = Object.keys(grouped).sort((a, b) => 
            grouped[b].lastMessageId - grouped[a].lastMessageId
          );
          
          const sorted = {};
          sortedPhones.forEach(p => sorted[p] = grouped[p]);
          
          // Check if there are new messages for the selected phone
          const currentSelectedCount = selectedPhone && sorted[selectedPhone] 
            ? sorted[selectedPhone].messages.length 
            : 0;
          const prevSelectedCount = prevMessageCountRef.current[selectedPhone] || 0;
          const hasNewMessages = currentSelectedCount > prevSelectedCount;
          
          // Update message counts
          Object.keys(sorted).forEach(phone => {
            prevMessageCountRef.current[phone] = sorted[phone].messages.length;
          });
          
          setConversations(sorted);
          setLastRefresh(new Date());
          setError(null);
          
          // Only set selectedPhone on initial load
          if (isInitialLoad && sortedPhones.length > 0) {
            setSelectedPhone(sortedPhones[0]);
            setIsInitialLoad(false);
          }
          
          // Scroll to bottom only if there are NEW messages
          if (hasNewMessages && messagesEndRef.current) {
            setTimeout(() => {
              messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }, 100);
          }
          
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      }, [selectedPhone, isInitialLoad]);

      const formatTime = (ts) => {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) {
          return d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
        }
        return d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      };

      const formatPhone = (p) => {
        if (!p || p.length < 10) return p || 'Unknown';
        return '+' + p.slice(0,2) + ' ' + p.slice(2,4) + ' ' + p.slice(4,7) + ' ' + p.slice(7);
      };

      const getLastMessage = (conv) => {
        if (!conv || !conv.messages || !conv.messages.length) return '';
        const last = conv.messages[conv.messages.length - 1];
        let content = last.content || '[No content]';
        // Clean up [GOMB] and [TEXT] prefixes for preview
        content = content.replace(/^\[(GOMB|TEXT)\]\s*/i, '');
        return content.length > 30 ? content.substring(0, 30) + '...' : content;
      };

      const cleanContent = (content) => {
        // Remove [GOMB] and [TEXT] prefixes for display
        return (content || '').replace(/^\[(GOMB|TEXT)\]\s*/i, '');
      };

      // Initial load
      useEffect(() => {
        fetchMessages();
      }, []);

      // Auto-refresh interval
      useEffect(() => {
        const interval = setInterval(fetchMessages, CONFIG.AUTO_REFRESH_SECONDS * 1000);
        return () => clearInterval(interval);
      }, [fetchMessages]);

      // Scroll to bottom ONLY when selecting a new phone
      const handleSelectPhone = (phone) => {
        setSelectedPhone(phone);
        setMobileShowChat(true);
        
        // Scroll to bottom when selecting a conversation
        setTimeout(() => {
          if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
          }
        }, 100);
      };

      const phones = Object.keys(conversations).filter(p => 
        p.toLowerCase().includes(searchTerm.toLowerCase())
      );

      if (loading && isInitialLoad) {
        return (
          <div className="min-h-screen bg-gray-900 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-4 animate-bounce">💬</div>
              <div className="text-white text-lg">Loading conversations...</div>
            </div>
          </div>
        );
      }

      if (error && Object.keys(conversations).length === 0) {
        return (
          <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="bg-red-500/20 border border-red-500 rounded-xl p-6 max-w-md text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <div className="text-red-300 text-lg mb-2">Connection Error</div>
              <div className="text-red-400 text-sm">{error}</div>
              <button 
                onClick={fetchMessages}
                className="mt-4 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg"
              >
                Retry
              </button>
            </div>
          </div>
        );
      }

      const conv = conversations[selectedPhone];

      return (
        <div className="h-screen bg-gray-900 flex overflow-hidden">
          <div className={(mobileShowChat ? 'hidden md:flex' : 'flex') + ' w-full md:w-80 bg-gray-800 border-r border-gray-700 flex-col'}>
            <div className="p-4 border-b border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-lg font-bold text-white">💬 {CONFIG.APP_TITLE}</h1>
                <button
                  onClick={fetchMessages}
                  disabled={loading}
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg"
                >
                  <svg className={'w-5 h-5 ' + (loading ? 'animate-spin' : '')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="🔍 Search by phone..."
                className="w-full bg-gray-700/50 text-white text-sm rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-green-500 border border-gray-600"
              />
            </div>
            
            <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-700 flex gap-4 text-xs text-gray-400">
              <span>📱 {Object.keys(conversations).length}</span>
              <span>💬 {Object.values(conversations).reduce((s, c) => s + c.messages.length, 0)}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {phones.length === 0 ? (
                <div className="p-4 text-center text-gray-500">No conversations</div>
              ) : phones.map(phone => (
                <div
                  key={phone}
                  onClick={() => handleSelectPhone(phone)}
                  className={'p-4 border-b border-gray-700/50 cursor-pointer transition-colors ' + (selectedPhone === phone ? 'bg-gray-700/70' : 'hover:bg-gray-700/30')}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold shadow-lg flex-shrink-0">
                      {phone ? phone.slice(-2) : '??'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-white text-sm truncate">{formatPhone(phone)}</span>
                        <span className="text-xs text-gray-500 ml-2">#{conversations[phone] ? conversations[phone].lastMessageId : 0}</span>
                      </div>
                      <p className="text-sm text-gray-400 truncate mt-0.5">{getLastMessage(conversations[phone])}</p>
                      <span className="text-xs text-gray-500">{conversations[phone] ? conversations[phone].messages.length : 0} msg</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="p-3 border-t border-gray-700 text-xs text-gray-500 text-center">
              {lastRefresh ? formatTime(lastRefresh) : ''} • Auto: {CONFIG.AUTO_REFRESH_SECONDS}s
            </div>
          </div>
          
          <div className={(mobileShowChat ? 'flex' : 'hidden md:flex') + ' flex-1 flex-col'}>
            {selectedPhone ? (
              <>
                <div className="px-4 py-4 border-b border-gray-700 bg-gray-800/50 flex items-center gap-3">
                  <button onClick={() => setMobileShowChat(false)} className="md:hidden p-2 -ml-2 text-gray-400">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold">
                    {selectedPhone ? selectedPhone.slice(-2) : '??'}
                  </div>
                  <div>
                    <div className="font-semibold text-white">{formatPhone(selectedPhone)}</div>
                    <div className="text-xs text-gray-400">{conv ? conv.messages.length : 0} messages</div>
                  </div>
                </div>
                
                <div 
                  ref={messagesContainerRef}
                  className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin bg-gray-900"
                >
                  {conv && conv.messages && conv.messages.map((msg, i) => {
                    const isUser = msg.type === 'human';
                    const content = cleanContent(msg.content);
                    return (
                      <div key={msg.id || i} className={'flex ' + (isUser ? 'justify-start' : 'justify-end')}>
                        <div className={'max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2.5 shadow-md ' + (isUser ? 'bg-gray-700 text-white rounded-bl-sm' : 'bg-blue-600 text-white rounded-br-sm')}>
                          <div className={'text-xs mb-1 ' + (isUser ? 'text-gray-400' : 'text-blue-200')}>
                            {isUser ? '👤 User' : '🤖 AI'}
                          </div>
                          <p className="text-sm whitespace-pre-wrap break-words">{content || '[Empty]'}</p>
                          <div className={'text-xs mt-1.5 ' + (isUser ? 'text-gray-400' : 'text-blue-200 text-right')}>
                            #{msg.id}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                
                <div className="px-4 py-3 border-t border-gray-700 bg-gray-800/50">
                  <div className="bg-gray-700/50 rounded-full px-4 py-3 text-gray-500 text-sm text-center">
                    👀 View-only • Auto-refresh: {CONFIG.AUTO_REFRESH_SECONDS}s
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <div className="text-6xl mb-4">💬</div>
                  <p>Select a conversation</p>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  
  res.writeHead(200, { 
    'Content-Type': 'text/html',
    'Cache-Control': 'no-cache'
  });
  res.end(html);
});

server.listen(PORT, () => {
  console.log('Callera Conversation Viewer running on port ' + PORT);
  console.log('Supabase URL: ' + (SUPABASE_URL ? 'configured' : 'NOT SET'));
  console.log('Supabase Key: ' + (SUPABASE_KEY ? 'configured' : 'NOT SET'));
});
