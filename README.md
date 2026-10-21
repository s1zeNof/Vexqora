# Vexqora Trade

Intelligent Trade Execution Platform

Signals · Execution · Risk Management · Automation

Demo-first signal execution for Bybit USDT perpetual contracts. The repository is an npm-workspaces monorepo with a Next.js web app, a long-running Node.js worker, shared domain contracts, and Supabase migrations.

## Current status

Stages 1-3 and the first Stage 4 vertical slice are implemented: strict TypeScript, authentication, RLS, encrypted credentials, Bybit V5 REST/private WebSocket adapter, demo funding, active-account switching, deterministic signal parsing, risk-based position sizing, chat preview/confirmation, execution jobs, and a mode-agnostic executor with protected exchange-hosted orders.

## Setup

1. Copy `.env.example` to `.env.local` and provide the Supabase URL and anon key.
2. Install dependencies with `npm install`.
3. Apply `supabase/migrations/202610210001_initial_schema.sql` to a Supabase project or run the local Supabase stack.
4. Run the web app with `npm run dev`.
5. Run the worker separately with `npm run dev:worker`.

## Deployment

- Supabase: link the local `supabase` directory to a project and push the migration.
- Vercel: import the repository from its root; `vercel.json` builds the Next.js workspace.
- Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `ENCRYPTION_MASTER_KEY` in Vercel.
- Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ENCRYPTION_MASTER_KEY` in the worker environment.

## Quality commands

```text
npm run typecheck
npm run lint
npm test
npm run build
```

## Security boundary

Exchange credentials and integration secrets must only be accepted by server-side code, encrypted with AES-256-GCM, and stored in encrypted columns. They must never be returned to the browser or logged. Use exchange keys with Read and Trade permissions only, never Withdraw.

Generate the encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and keep it outside source control.
