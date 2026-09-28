# Talk to Krishna

A live, spoken, interruptible conversation with Krishna as a compassionate counsellor, grounded in
the Bhagavad Gita, the stories of his life and his other teachings.
Next.js 16 · Supabase (login, transcripts, quota) · fal (Grok Voice realtime) · Vercel.

## How it fits together

- **Browser ↔ fal** holds the voice WebSocket, authorised by a 120-second token from
  `/api/fal/realtime-token` (login and daily quota are checked there).
- **Scripture search** is a function tool: Grok calls `search_scriptures`, the browser answers from
  `/api/search`, a BM25 index over `data/corpus.json` (3,982 English passages built from
  `../01-bhagavad-gita`, `../02-life-stories`, `../03-other-teachings` by `npm run build:corpus`).
- **Supabase** holds accounts, each user's transcripts (row-level security) and minutes used.

## Local development

`npm run dev` serves http://localhost:3456. With only `FAL_KEY` in `.env.local` the app runs in
**try mode**: no login, nothing saved. Add the Supabase variables to run the full app.

## Deploying

1. **Supabase:** create a project, then in SQL Editor run
   `supabase/migrations/20260928000000_init.sql`.
2. **Supabase → Authentication → URL Configuration:** Site URL `https://<your-domain>`; redirect URLs
   `https://<your-domain>/auth/callback` and `http://localhost:3456/auth/callback`.
3. **Vercel → Settings → Environment Variables** (from `.env.example`): `FAL_KEY`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Project Settings → API),
   `KRISHNA_VOICE`, `DAILY_MINUTES_LIMIT`. Then redeploy.
4. Set a monthly spend limit in the fal dashboard, and a Vercel Firewall rate limit on
   `/api/fal/realtime-token`.

If a deploy is missing variables, every page answers 503 naming the ones to add.

## Notes from building it

- fal's realtime client holds only one pending message while connecting, so the mic stays muted
  until `session.updated`; persona, voice and turn detection go on fal's `x-fal-session.configure`
  event, and tools and transcription on a native `session.update`.
- fal drops the socket on large client messages (~6 KB failed, ~2 KB works), so search results sent
  to Grok are trimmed to three passages.
- In dev, each new Grok event type is logged once as `[grok event]`.
