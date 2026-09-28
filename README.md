# Talk to Krishna

A live, spoken, interruptible conversation with a Krishna persona, grounded in the 701 verses
of the Bhagavad Gita. Next.js 16 · Supabase · fal (Grok Voice realtime) · Vercel.

## How it fits together

- **Browser ↔ fal** holds the long-lived voice WebSocket, authorised by a 120-second token from `/api/fal/realtime-token` (login + daily quota checked there).
- **xAI → `/api/mcp`** is the Gita tool server Grok calls (`search_gita`, `get_verse`). It must be publicly reachable, so localhost can't serve it.
- **Supabase** holds the verses (pgvector + `gte-small` via the `search-gita` Edge Function) and each user's transcripts (RLS).

## Setup

1. **Test the voice first** at https://fal.ai/models/xai/grok-voice/realtime with the prompt in `lib/krishna.ts`. Pick a voice.
2. `cp .env.example .env.local` and fill it in. Set a spend limit in the fal dashboard.
3. **Database:** run `supabase/migrations/20260928000000_init.sql` in the Supabase SQL editor (or `npx supabase db push`).
4. **Edge Function:** `npx supabase login && npx supabase link --project-ref <ref> && npx supabase functions deploy search-gita`
5. **Seed the verses** (reads `../01-bhagavad-gita/json` from this corpus; uses the public-domain Purohit Swami translation):
   `node --env-file=.env.local scripts/seed-gita.mjs`
   Then check with `select count(*) from gita_verses where embedding is not null;`, which should return 701.
6. **Auth:** Supabase → Authentication → URL Configuration: add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback`.
7. **Deploy to Vercel** with the env vars from `.env.example`, except `SUPABASE_SERVICE_ROLE_KEY`. Set `NEXT_PUBLIC_MCP_URL=https://<your-domain>/api/mcp`, then redeploy.
   Add Vercel Firewall rate limits on `/api/mcp` and `/api/fal/realtime-token`.
8. `npm run dev`: keep `NEXT_PUBLIC_MCP_URL` pointed at the deployed URL.

## First run

Open DevTools and start a conversation. In dev, every new Grok event type is logged once (`[grok event]`).
If the audio or transcript event names differ from the `switch` in `components/KrishnaVoice.tsx`, rename the cases there.
Verse cards appear under the orb when Grok's MCP events carry the tool output. If none appear, check which `mcp` events are logged.

## Differences from the original build guide

- Next 16: `middleware.ts` is now `proxy.ts`.
- `mcp-handler` v2: uses `@modelcontextprotocol/server` v2 and `registerTool`; route lives at `app/api/mcp/route.ts`.
- Seed reads the local corpus and embeds with the anon key (works with the new non-JWT secret keys).
- Added: an audio-reactive orb, verse cards, a history page with delete, a remaining-minutes display, and a client hard cap at the quota.
