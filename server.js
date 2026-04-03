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

    // Parse AI message content - extract just the message field from JSON
    const parseAiContent = (content) => {
      if (!content) return { message: '[Empty]', buttons: [] };
      
      try {
        // Remove markdown code blocks if present
        let cleaned = content.trim();
        if (cleaned.startsWith('\`\`\`json')) {
          cleaned = cleaned.slice(7);
          if (cleaned.endsWith('\`\`\`')) cleaned = cleaned.slice(0, -3);
        } else if (cleaned.startsWith('\`\`\`')) {
          cleaned = cleaned.slice(3);
          if (cleaned.endsWith('\`\`\`')) cleaned = cleaned.slice(0, -3);
        }
        cleaned = cleaned.trim();
        
        const parsed = JSON.parse(cleaned);
        
        // Extract message
        const message = parsed.message || '[No message]';
        
        // Extract buttons from send_interactive
        let buttons = [];
        if (parsed.send_interactive && parsed.send_interactive.buttons) {
          buttons = parsed.send_interactive.buttons.map(b => b.title || b.id);
        }
        
        return { message, buttons };
      } catch (e) {
        // If not JSON, return as-is
        return { message: content, buttons: [] };
      }
    };

    // Clean user message - remove [TEXT] and [GOMB] prefixes
    const parseUserContent = (content) => {
      if (!content) return '';
      
      // Remove [TEXT] prefix
      if (content.startsWith('[TEXT]')) {
        return content.replace(/^\\[TEXT\\]\\s*/i, '');
      }
      
      // Handle [GOMB] - show as button click
      if (content.startsWith('[GOMB]')) {
        let cleaned = content.replace(/^\\[GOMB\\]\\s*/i, '');
        // Format: "challenge_losing: Pierd clienți" -> "🔘 Pierd clienți"
        const colonIdx = cleaned.indexOf(':');
        if (colonIdx > -1) {
          cleaned = cleaned.slice(colonIdx + 1).trim();
        }
        return '🔘 ' + cleaned;
      }
      
      return content;
    };

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
      const prevMessageCountRef = useRef({});

      const fetchMessages = useCallback(async () => {
        if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
          setError('Supabase credentials not configured');
          setLoading(false);
          return;
        }
        
        try {
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
            throw new Error('Failed to fetch: ' + response.status);
          }
          
          const data = await response.json();
          
          // Group by session_id (phone) - TRIM to avoid duplicates
          const grouped = data.reduce((acc, row) => {
            const phone = (row.session_id || 'Unknown').toString().trim();
            if (!acc[phone]) {
              acc[phone] = { messages: [], lastMessageId: 0 };
            }
            
            const msg = row.message || {};
            const isAi = msg.type === 'ai';
            
            // Parse content based on type
            let displayContent, buttons = [];
            if (isAi) {
              const parsed = parseAiContent(msg.content);
              displayContent = parsed.message;
              buttons = parsed.buttons;
            } else {
              displayContent = parseUserContent(msg.content);
            }
            
            acc[phone].messages.push({
              id: row.id,
              type: msg.type || 'unknown',
              content: displayContent,
              buttons: buttons,
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
          
          // Check for new messages
          const currentSelectedCount = selectedPhone && sorted[selectedPhone] 
            ? sorted[selectedPhone].messages.length 
            : 0;
          const prevSelectedCount = prevMessageCountRef.current[selectedPhone] || 0;
          const hasNewMessages = currentSelectedCount > prevSelectedCount;
          
          Object.keys(sorted).forEach(phone => {
            prevMessageCountRef.current[phone] = sorted[phone].messages.length;
          });
          
          setConversations(sorted);
          setLastRefresh(new Date());
          setError(null);
          
          if (isInitialLoad && sortedPhones.length > 0) {
            setSelectedPhone(sortedPhones[0]);
            setIsInitialLoad(false);
          }
          
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
        const content = last.content || '[No content]';
        return content.length > 35 ? content.substring(0, 35) + '...' : content;
      };

      useEffect(() => { fetchMessages(); }, []);

      useEffect(() => {
        const interval = setInterval(fetchMessages, CONFIG.AUTO_REFRESH_SECONDS * 1000);
        return () => clearInterval(interval);
      }, [fetchMessages]);

      const handleSelectPhone = (phone) => {
        setSelectedPhone(phone);
        setMobileShowChat(true);
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
              <div className="text-white text-lg">Loading...</div>
            </div>
          </div>
        );
      }

      if (error && Object.keys(conversations).length === 0) {
        return (
          <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="bg-red-500/20 border border-red-500 rounded-xl p-6 max-w-md text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <div className="text-red-300 text-lg mb-2">Error</div>
              <div className="text-red-400 text-sm">{error}</div>
              <button onClick={fetchMessages} className="mt-4 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg">Retry</button>
            </div>
          </div>
        );
      }

      const conv = conversations[selectedPhone];

      return (
        <div className="h-screen bg-gray-900 flex overflow-hidden">
          {/* Sidebar */}
          <div className={(mobileShowChat ? 'hidden md:flex' : 'flex') + ' w-full md:w-80 bg-gray-800 border-r border-gray-700 flex-col'}>
            <div className="p-4 border-b border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-lg font-bold text-white">💬 {CONFIG.APP_TITLE}</h1>
                <button onClick={fetchMessages} disabled={loading} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg">
                  <svg className={'w-5 h-5 ' + (loading ? 'animate-spin' : '')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="🔍 Search..." className="w-full bg-gray-700/50 text-white text-sm rounded-lg px-4 py-2.5 outline-none border border-gray-600" />
            </div>
            
            <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-700 flex gap-4 text-xs text-gray-400">
              <span>📱 {phones.length}</span>
              <span>💬 {Object.values(conversations).reduce((s, c) => s + c.messages.length, 0)}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {phones.length === 0 ? (
                <div className="p-4 text-center text-gray-500">No conversations</div>
              ) : phones.map(phone => (
                <div key={phone} onClick={() => handleSelectPhone(phone)} className={'p-4 border-b border-gray-700/50 cursor-pointer transition-colors ' + (selectedPhone === phone ? 'bg-gray-700/70' : 'hover:bg-gray-700/30')}>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold shadow-lg flex-shrink-0">
                      {phone.slice(-2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-white text-sm truncate block">{formatPhone(phone)}</span>
                      <p className="text-sm text-gray-400 truncate mt-0.5">{getLastMessage(conversations[phone])}</p>
                      <span className="text-xs text-gray-500">{conversations[phone].messages.length} msg</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="p-3 border-t border-gray-700 text-xs text-gray-500 text-center">
              {lastRefresh ? formatTime(lastRefresh) : ''} • {CONFIG.AUTO_REFRESH_SECONDS}s
            </div>
          </div>
          
          {/* Chat */}
          <div className={(mobileShowChat ? 'flex' : 'hidden md:flex') + ' flex-1 flex-col'}>
            {selectedPhone ? (
              <>
                <div className="px-4 py-4 border-b border-gray-700 bg-gray-800/50 flex items-center gap-3">
                  <button onClick={() => setMobileShowChat(false)} className="md:hidden p-2 -ml-2 text-gray-400">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold">{selectedPhone.slice(-2)}</div>
                  <div>
                    <div className="font-semibold text-white">{formatPhone(selectedPhone)}</div>
                    <div className="text-xs text-gray-400">{conv ? conv.messages.length : 0} messages</div>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin bg-gray-900">
                  {conv && conv.messages.map((msg, i) => {
                    const isAi = msg.type === 'ai';
                    return (
                      <div key={msg.id || i} className={'flex ' + (isAi ? 'justify-start' : 'justify-end')}>
                        <div className="max-w-[85%] md:max-w-[70%]">
                          <div className={'rounded-2xl px-4 py-2.5 shadow-md ' + (isAi ? 'bg-gray-700 text-white rounded-bl-sm' : 'bg-blue-600 text-white rounded-br-sm')}>
                            <div className={'text-xs mb-1 ' + (isAi ? 'text-gray-400' : 'text-blue-200')}>
                              {isAi ? '🤖 AI' : '👤 User'}
                            </div>
                            <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                          </div>
                          {isAi && msg.buttons && msg.buttons.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {msg.buttons.map((btn, bi) => (
                                <span key={bi} className="inline-block bg-gray-600 text-white text-xs px-3 py-1.5 rounded-full border border-gray-500">{btn}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                
                <div className="px-4 py-3 border-t border-gray-700 bg-gray-800/50">
                  <div className="bg-gray-700/50 rounded-full px-4 py-3 text-gray-500 text-sm text-center">👀 View-only</div>
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
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log('Callera Viewer on port ' + PORT);
});
