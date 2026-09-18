# ECHO — The Assistant That Never Forgets... Or Does It?

ECHO is a conversational memory system: talk normally, let ECHO decide what is worth remembering, retrieve relevant memories later, and track changes over time.

## What is fixed

- Normal conversational chat; memory mechanics stay out of the way.
- Questions are retrieval-only and are never stored as memories.
- Introductions such as `Hi, I am Hriday` are remembered.
- Statements about other people such as `Amogh is a good boy` are remembered.
- Identity questions such as `Who am I?` retrieve identity memory.
- Relative-time statements such as `Tomorrow is my physics exam` can be recalled later.
- Contradictory facts can supersede earlier active memories.
- Gemini handles memory routing and response generation.
- Gemini embeddings + Supabase pgvector are used when Supabase is configured.
- Without Supabase, ECHO persists locally in `.data/memories.json`.
- User/project IDs scope memory retrieval.
- Technical memory/audit information lives in the Memory Graph and Audit views rather than interrupting normal chat.

## Run on Windows PowerShell

```powershell
cd D:\path\to\echo-system
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Gemini

Put your Gemini key in `.env.local`:

```env
GEMINI_API_KEY=YOUR_KEY
GEMINI_MODEL=gemini-2.5-flash
```

Do not commit `.env.local` or share the key.

## Supabase (optional but recommended for the full RAG demo)

Run `supabase/schema.sql` in the Supabase SQL editor, then set:

```env
NEXT_PUBLIC_SUPABASE_URL=YOUR_URL
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

The service role key is server-side only. Never expose it as `NEXT_PUBLIC_*`.

## Demo script

1. Open ASK ECHO.
2. Say: `Hi, I am Hriday.`
3. Have a normal conversation.
4. Ask: `Hey ECHO, who am I?`
5. ECHO should answer `You're Hriday.` using the stored identity memory.
6. Say: `Tomorrow is my physics exam.`
7. Ask: `When is my physics exam?`
8. Say: `We switched from React to Vue.`
9. Ask: `What frontend are we using?`
10. Open Memory Graph / Evolution to show the underlying memory lifecycle to judges.
