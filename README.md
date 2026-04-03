# Conversation Viewer

WhatsApp chat viewer that reads from Supabase. Shows conversations grouped by phone number.

## Railway Deployment (2 perc)

### 1. Hozz létre új projektet Railway-en
- https://railway.app
- New Project → Deploy from GitHub repo (vagy "Empty Project")

### 2. Ha GitHub nélkül:
- New Project → Empty Project
- Add Service → Empty Service
- Settings → Deploy from local (töltsd fel ezeket a fájlokat)

### 3. Environment Variables beállítása
Railway Dashboard → Variables:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...
APP_TITLE=Alex Valah WhatsApp
```

### 4. Kész!
Railway ad egy URL-t: `https://conversation-viewer-xxx.up.railway.app`

---

## Több kliens kezelése

Minden kliensnek külön Railway service:
- `alex-valah-viewer.up.railway.app` → Alex Supabase credentials
- `masik-kliens-viewer.up.railway.app` → Másik kliens Supabase credentials

Vagy egy projektben több service, mindegyiknek saját env vars.

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_KEY` | Supabase anon/public key | `eyJhbG...` |
| `APP_TITLE` | App title (optional) | `Alex Valah WhatsApp` |
| `PORT` | Server port (Railway sets automatically) | `3000` |

---

## Supabase Setup

A viewer a `Messages` táblából olvas:
- `message_sender` - telefonszám (csoportosítás alapja)
- `message_content` - üzenet szövege  
- `message_source` - `user` vagy `inbound_bot`
- `created_at` - időbélyeg

### RLS (Row Level Security)
Ha RLS be van kapcsolva, győződj meg róla hogy az anon key olvashat:

```sql
CREATE POLICY "Allow public read" ON "Messages"
FOR SELECT USING (true);
```

---

## Local Development

```bash
# Environment variables
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_KEY=eyJhbG...

# Run
node server.js

# Open http://localhost:3000
```
