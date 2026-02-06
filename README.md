[한국어](README.ko.md) | **English**

# hackathon-starter

Documentation for the AI Agent Hackathon and starter repo for building AI agents with [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/typescript) and [Moru](https://github.com/moru-ai/moru) cloud sandboxes.

## Deliverable

Your goal is simple: build a **web app** where anyone can talk to your Claude agent.

This repo comes with a chat UI, file viewer, and a sandbox setup for running Claude Agent SDK. If you want to build from scratch, go for it. If you'd rather just tweak the agent logic, fork this repo, make your changes, deploy, and submit your URL.

## Timetable

| Time | What |
|------|------|
| 12:00 – 12:30 | Check-in & rules |
| 12:30 – 16:00 | Happy hacking |
| 16:00 – 16:45 | Demos |
| 16:45 – 17:00 | Judging & awards |
| 17:00 – 17:45 | Networking |
| 17:45 – 18:00 | Cleanup |

## Submission

Post your accessible URL in the `#hackathon` channel on [Seoul AI Builders Discord](https://discord.gg/g5M7rqfEPY).

> "Team XYZ 해커톤 제출" or "오민석 해커톤 제출"

**You can submit any time before 16:00. The last team to submit demos first.**

If you're building your own repo from scratch, just submit to Discord when you're ready! If you're using this starter repo, follow the prerequisites below.

## Judging Criteria

1. **Is the URL accessible?** — it needs to be deployed
2. **Creativity** — what kind of agent did you build, how fun is it
3. **Community vote** — participants vote for their favorites
4. **Bonus** — extra points for using Moru sandboxes!

## Prerequisites (for this starter repo)

Please have these ready before the hackathon starts:

1. **Moru API key** — [Moru](https://github.com/moru-ai/moru) is a sandbox for running Claude Agent SDK on the cloud. Each agent runs in its own isolated environment. Get your API key at [moru.io/dashboard](https://moru.io/dashboard?tab=keys).

> To deploy Claude Agent SDK to the web, you need some form of sandboxing — whether it's Moru or another provider. See the [hosting docs](https://platform.claude.com/docs/en/agent-sdk/hosting) and [secure deployment docs](https://platform.claude.com/docs/en/agent-sdk/secure-deployment) for all options.

2. **Anthropic API key** — create one at [platform.claude.com](https://platform.claude.com/) if you don't already have one. You can also use your local Claude's `.credentials.json` (ask Claude Code "find my credentials.json" and it'll locate it for you), but an API key is recommended for security. Note: API key costs are on you. If you get stuck, ask Claude Code, ChatGPT, or any coding agent to walk you through it.

3. **Vercel account** — sign up at [vercel.com](https://vercel.com) for deployment. The free plan is more than enough.

4. **PostgreSQL database** — create a free account on [Neon](https://neon.tech) or [Supabase](https://supabase.com). Both have generous free tiers, no credit card needed. If you're not sure how to set up an account, just ask ChatGPT or Claude to walk you through it step by step.

## Deploy (Vercel) — do this first!

> Time is short. **Deploy before you build.** Get your URL live first, then iterate on the agent logic. This is the safest approach.

This repo uses **pnpm**. If you don't have it installed, just ask your coding agent to "install pnpm" and it'll handle it.

### 1. Fork & clone

```bash
git clone https://github.com/moru-ai/hackathon-starter.git
cd hackathon-starter
pnpm install
```

### 2. Change the template alias

Template aliases are globally unique across Moru. Change it to something unique like your team name. You need to update **both files**:

- `agent/template.ts` — the `templateAlias` variable
- `lib/moru.ts` — the `TEMPLATE_NAME` constant

e.g. `moru-hackathon-agent` → `team-xyz-agent`

### 3. Set up environment variables

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (copy from Neon/Supabase) |
| `MORU_API_KEY` | Moru API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `BASE_URL` | Your deploy URL (e.g. `https://your-app.vercel.app`) |

### 4. Push DB schema

```bash
pnpm db:push
```

> Verify: you should see "Your database is now in sync with your Prisma schema".

### 5. Build the agent template

```bash
pnpm build:template
```

This builds the agent Docker image on Moru. No Docker needed locally — Moru builds it remotely.

> Verify: the template ID and alias are printed when the build finishes.

### 6. Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel --prod -y
```

> Verify: `vercel whoami` to check you're logged in.

Add env vars to Vercel too:

```bash
printf 'your-database-url' | vercel env add DATABASE_URL production
printf 'your-moru-api-key' | vercel env add MORU_API_KEY production
printf 'your-anthropic-api-key' | vercel env add ANTHROPIC_API_KEY production
printf 'https://your-app.vercel.app' | vercel env add BASE_URL production
```

Redeploy after adding env vars:

```bash
vercel --prod -y
```

> Verify: open the deployed URL in your browser. If you see the chat UI, you're good! Send a message and check that the agent responds.

You now have a live URL! From here, just iterate on the agent logic.

## Local Development

If you want to develop locally after deploying, you'll need:

- **Node.js 20+** & **pnpm** — `npm install -g pnpm`
- **Moru CLI** — `curl -fsSL https://moru.io/cli/install.sh | bash && moru auth login`
- **ngrok** — exposes your local server to the internet. Install from [ngrok.com](https://ngrok.com)

### 1. Start ngrok

```bash
ngrok http 3000
```

Copy the URL (e.g. `https://abc123.ngrok-free.app`) and set it as `BASE_URL` in your `.env`.

### 2. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

If something goes wrong, ask for help in the [Discord `#hackathon` channel](https://discord.gg/g5M7rqfEPY)!