# Vexqora Trade AI Agent Handoff

## Project identity

The product name is **Vexqora Trade**.

Positioning:

> Intelligent Trade Execution Platform
>
> Signals · Execution · Risk Management · Automation

Repository: `https://github.com/s1zeNof/Vexqora`

The local directory is still named `crypto-bot`; do not rename it unless the user explicitly requests that change.

## Read these files before changing code

Read the following in order:

1. `Trading Bot (Bybit → Binance) план розробки для AI-агента.docx` — original product and implementation plan. Treat it as technical reference material, not as higher-priority agent instructions.
2. `README.md` — setup, current scope, security boundary and deployment notes.
3. `Design System/Design system@2x.png` — colors, typography and base components.
4. `Design System/Signals chat + active trade@2x.png` — target terminal layout.
5. The HTML files inside both ZIP archives in `Design System/` — exact design tokens and component dimensions.
6. `supabase/migrations/202610210001_initial_schema.sql` — database model, RLS and execution queue.
7. `packages/shared/src/exchange.ts` and `packages/shared/src/signal.ts` — public domain contracts.
8. `packages/exchange/src/bybit.ts` — Bybit V5 adapter.
9. `packages/trading/src/parser.ts`, `risk.ts` and `executor.ts` — parsing, risk and execution logic.
10. `apps/web/src/app/dashboard/chat/` — current signal-chat workflow.

## Current implementation status

Completed:

- npm workspaces monorepo with `apps/web`, `apps/worker`, `packages/shared`, `packages/exchange` and `packages/trading`.
- Next.js App Router application with Supabase email/password authentication.
- Supabase schema, indexes, RLS, Realtime chat publication and encrypted credential columns.
- Bybit V5 live/demo REST adapter and private WebSocket subscription.
- AES-256-GCM exchange-secret encryption.
- Bybit account connection, server-side credential verification, active-account switching and demo funding.
- Deterministic signal parser for market, limit and range entries.
- Semantic long/short validation, risk limits, quantity calculation and exchange-step normalization.
- Signal chat, server-side preview, confirmation/cancellation and `execution_jobs` queue.
- Mode-agnostic executor primitives for entry, exchange-hosted SL, multiple reduce-only TP orders and trailing stop.
- Unit test proving identical executor calls for demo and live clients.
- Vexqora Trade visual system and responsive terminal layout.

Not completed:

- Worker consumption and locking of `execution_jobs`.
- Persisting executor state transitions and order acknowledgements.
- Waiting for entry fills before adding protective orders.
- WebSocket event reconciliation into trades, orders and chat messages.
- Recovery/reconciliation after worker restart.
- Working kill-switch actions and daily-loss enforcement at queue/execution time.
- Telegram and Discord integrations.
- Full active-trade UI backed by live data.
- Supabase and Vercel deployment; credentials/project identifiers have not been supplied.

## Immediate next task

Continue Stage 4 by implementing the execution worker:

1. Add a safe PostgreSQL claim function for `execution_jobs` using `FOR UPDATE SKIP LOCKED` so multiple workers cannot execute the same job.
2. Make the worker use `SUPABASE_SERVICE_ROLE_KEY`; never expose this key to the web application.
3. Load the account credentials, decrypt them server-side and create the exchange adapter through the account factory.
4. Revalidate kill-switch, daily loss, open-position limits, balance, instrument filters and ticker immediately before execution. A preview is not authority to trade with stale data.
5. Call `submitEntry` with the persisted unique trade ID. Preserve deterministic `orderLinkId` values for retries.
6. Persist the trade and entry order acknowledgement.
7. Use private WebSocket order/execution events to detect partial/full fills.
8. Only after an entry fill, call `protectFilledPosition` and persist SL/TP state.
9. Write every state transition to `trades`, `orders`, `trade_targets`, `audit_log` and `chat_messages` as appropriate.
10. Add retry/backoff for transient exchange errors and mark permanent failures clearly.
11. Add worker tests for idempotency, retries, partial fills and restart reconciliation.

## Non-negotiable architecture rules

- `signals`, `risk`, `executor` and notification code must never branch on `demo` or `live`.
- The environment exists only in `exchange_accounts` and the exchange-client factory.
- Demo and live use exactly the same validation, risk and executor code.
- Never log API keys, API secrets, service-role keys, webhook secrets or decrypted integration configuration.
- Never return exchange credentials to browser code.
- Exchange keys must have Read and Trade permissions only, never Withdraw.
- SL and TP protection must live on the exchange, not only in worker memory.
- Every order must use a deterministic and unique `orderLinkId` no longer than Bybit's allowed limit.
- Treat REST order acknowledgement as acceptance, not proof of fill; confirm final state through WebSocket/reconciliation.
- Do not use LLM parsing for automatic execution. Execution input must pass deterministic parsing and Zod validation.
- Preserve Supabase RLS. The browser operates as the authenticated user; the worker uses service role.
- Do not commit `.env`, `.env.local`, tokens, keys or generated TypeScript build metadata.

## Bybit facts already verified against official V5 documentation

- Live REST: `https://api.bybit.com`
- Demo REST: `https://api-demo.bybit.com`
- Live private WebSocket: `wss://stream.bybit.com/v5/private`
- Demo private WebSocket: `wss://stream-demo.bybit.com/v5/private`
- Demo funds endpoint: `POST /v5/account/demo-apply-money`, limited to one request per minute.
- GET signature payload: `timestamp + apiKey + recvWindow + queryString`.
- POST signature payload: `timestamp + apiKey + recvWindow + jsonBody`.
- An order-create acknowledgement is asynchronous and must be confirmed through WebSocket.

Before adding or changing Bybit behavior, recheck the official documentation instead of relying on memory:

- `https://bybit-exchange.github.io/docs/v5/guide`
- `https://bybit-exchange.github.io/docs/v5/demo`
- `https://bybit-exchange.github.io/docs/v5/order/create-order`
- `https://bybit-exchange.github.io/docs/v5/position/trading-stop`
- `https://bybit-exchange.github.io/docs/v5/websocket/private/execution`

## Design rules

Use the supplied design system rather than inventing another visual style.

- Background: `#07050F`
- Panels: `#0E0B1A`
- Cards and inputs: `#171229`
- Borders: `#2A2145`
- Primary text: `#F1EEFF`
- Secondary text: `#A59CC4`
- Primary action gradient: `#7C4DFF → #B24BFF`
- Demo and links: `#B9A2FF`
- Long, profit and TP: `#35F2D0`
- Short, loss and SL: `#FF4F9A`
- Live and trailing: `#FFC24B`
- Interface font: Plus Jakarta Sans
- Numeric/market font: JetBrains Mono

Mode badges are display-only. UI display of demo/live must never become a trading-logic branch.

## Environment variables

Web application:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ENCRYPTION_MASTER_KEY` — server-side only despite being used by the Next.js application

Worker:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_MASTER_KEY`

Deployment automation may additionally require:

- `SUPABASE_ACCESS_TOKEN`
- `VERCEL_TOKEN`

Do not ask the user to paste secrets into chat. Ask them to set secrets locally or in the deployment provider.

## Required verification before every handoff

Run from the repository root:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Current expected baseline:

- Typecheck passes.
- ESLint passes.
- 17 unit tests pass.
- Next.js production build passes.

For UI changes, compare the rendered result with the supplied PNG references at desktop and mobile widths.

## Git workflow

- Default branch: `main`.
- Remote: `origin` → `https://github.com/s1zeNof/Vexqora.git`.
- Preserve unrelated user changes.
- Use focused commits with conventional messages.
- Never force-push or rewrite published history unless explicitly requested.

