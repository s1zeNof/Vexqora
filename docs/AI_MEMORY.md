# Vexqora Trade — Master AI Memory & Handoff Guide

> **Target Audience**: AI Agents (Antigravity, Claude, ChatGPT, Cursor, Copilot) & Engineers continuing development on a new environment (e.g. laptop).
> **Last Updated**: 2026-10-23 (Post Paper Matching Engine & Autopilot Switcher)
> **Repository**: `https://github.com/s1zeNof/Vexqora`
> **Active Production URL**: `https://vexqora.vercel.app/`

---

## 1. Project Identity & Positioning

- **Product Name**: Vexqora Trade
- **Tagline**: *Intelligent Trade Execution Platform*
- **Core Pillars**: Signals · Execution · Risk Management · Automation
- **Target Audience**: Crypto traders (beginners to advanced) wanting institutional-grade risk management, automated execution on Bybit (Demo/Live) or keyless virtual Paper trading, paired with real-time AI market scanning and reasoning.

---

## 2. Monorepo Architecture & Tech Stack

This project is an **npm workspaces** monorepo using TypeScript with strict mode:

```
Vexqora-trade/
├── apps/
│   ├── web/           # Next.js 16 App Router (Turbopack), React 19, Supabase Auth/Client, Server Actions
│   └── worker/        # Long-running Node.js daemon (Runner, Pulse Scanner, Reconciler, Notifications)
├── packages/
│   ├── shared/        # Types, Zod schemas, DB interfaces (database.ts, exchange.ts, signal.ts)
│   ├── exchange/      # Bybit V5 REST/WS client (bybit.ts), Paper client (paper.ts), AES-256-GCM (crypto.ts)
│   └── trading/       # Deterministic Parser, Risk Math, Mode-agnostic Executor, Pulse, Memory, Nemotron
├── supabase/
│   └── migrations/    # 5 PostgreSQL migration files with schema, RLS, triggers & RPCs
├── docs/              # Project memory, architecture specifications, and runbooks
├── AGENTS.md          # Global AI agent instructions & non-negotiable guidelines
└── README.md          # Project overview & local setup
```

### Core Technologies
- **Frontend**: Next.js 16.4.2 (Turbopack), React 19, Vanilla CSS Design System with CSS variables (no Tailwind), Plus Jakarta Sans & JetBrains Mono fonts.
- **Backend / Database**: Supabase (PostgreSQL 15+, Auth, Row-Level Security, Realtime channels, RPC functions).
- **Execution Engine**: Mode-agnostic trading engine, Bybit V5 API (Perpetual Futures / Linear USDT), AES-256-GCM encryption for exchange secrets.
- **AI Intelligence**: OpenRouter API powering `nvidia/nemotron-3-ultra-550b-a55b:free` with step-by-step reasoning tokens, combined with deterministic parsing and historical pattern matching (`memory.ts`).

---

## 3. The Three Account Modes (Crucial Invariant!)

1. **`paper` (Vexqora Paper)**:
   - **Keyless**: No API keys required. Automatically provisioned upon user registration with **10,000 virtual USDT**.
   - Virtual balance is stored and managed in `exchange_accounts.paper_balance`.
   - Uses real Bybit market prices (`paper.ts`) without authentication headers.
   - Ideal for testing strategies and SaaS onboarding without connecting external exchanges.

2. **`demo` (Bybit Demo)**:
   - External Bybit Demo Trading account (`https://api-demo.bybit.com`).
   - Requires user's Bybit Demo API Key & Secret (encrypted via AES-256-GCM).
   - Real Bybit testnet execution with test funds.

3. **`live` (Bybit Live)**:
   - Real money trading on Bybit (`https://api.bybit.com`).
   - Requires API Key & Secret with **Read + Trade** permissions only (**NEVER Withdraw**).
   - Encrypted with AES-256-GCM using `ENCRYPTION_MASTER_KEY`.

> [!IMPORTANT]
> **Non-negotiable rule**: The core trading logic (`parser.ts`, `risk.ts`, `executor.ts`) **must never branch on `demo`, `live`, or `paper`**.
> The mode is strictly an infrastructure concern handled by the account factory (`createAccountClient` / `createBybitClient` / `createPaperExchangeClient`).

---

## 4. Key Subsystems Implemented

### 4.1. Vexqora Pulse (24/7 Market Anomaly Scanner)
- Located in: `packages/trading/src/pulse.ts` & `apps/worker/src/pulse-scanner.ts`.
- Continuously polls Bybit ticker data across all USDT linear perpetual pairs.
- Detects rapid price movements (e.g., `+3.2% in 30s`), volume spikes, and liquidity sweeps.
- Dispatches alert cards into `chat_messages` table as `pulse` messages with relative timestamps.

### 4.2. Vexqora Memory (Historical Pattern Engine)
- Located in: `packages/trading/src/memory.ts`.
- Stores quantitative historical market patterns (e.g. `liquidity_sweep`, `momentum_breakout`, `trend_continuation`).
- Calculates historical sample counts, win-rate percentages, and expected profit factors.
- Displays pattern context directly on AI trade recommendations in the UI.

### 4.3. Vexqora Signals (Nemotron 3 Ultra + Deterministic Pipeline)
- Located in: `packages/trading/src/nemotron.ts` and `apps/web/src/app/dashboard/chat/actions.ts`.
- Calls Nvidia Nemotron 3 Ultra via OpenRouter to analyze market anomalies and formulate trade setups.
- **Safety guarantee**: LLM output is parsed through the **deterministic parser** (`parseSignalText`) and validated by **mathematical risk constraints** (`createTradePreview`). The LLM cannot directly place orders or bypass risk limits.

### 4.4. Relative Timestamps (`formatTimeAgo`)
- Located in: `apps/web/src/app/dashboard/chat/page.tsx`.
- Formats messages in real-time as `{X} sec ago`, `{X} min ago`, `{X} h ago`, or `just now`.

### 4.5. Safe Server Actions & Error Handling
- Located in: `apps/web/src/app/dashboard/chat/actions.ts` & `apps/web/src/app/dashboard/error.tsx`.
- Any exception during AI signal creation, pulse analysis, or trade preview is caught gracefully.
- Next.js `redirect()` is safely preserved via `isRedirectError(error)`.
- Fallbacks are implemented for risk settings (`.limit(1).maybeSingle()`) with bounded leverage (`Math.min(leverage, 5)`).

### 4.6. Paper Matching Engine & Control Mode Switcher (Autopilot vs Manual)
- Located in: `packages/trading/src/paper-engine.ts`, `apps/web/src/lib/paper-service.ts`, `apps/web/src/app/api/trading/paper-tick/route.ts`, and `apps/worker/src/paper-worker.ts`.
- **Pure Matching Engine (`evaluatePaperTrade`)**:
  - Deterministically evaluates active paper positions against incoming market ticks.
  - **Partial Take Profit**: TP1 closes 40% of initial position, credits USDT to `exchange_accounts.paper_balance`, and activates the dynamic Trailing Stop. TP2 closes 30%. TP3 closes the final 30% and moves the trade to `closed` status.
  - **Dynamic Trailing Stop**: After TP1 is filled, tracks local peak price (`highestPrice` / `lowestPrice`). If price pulls back 1% from peak, remaining quantity is market-closed, and remaining open targets are cancelled.
  - **Protective Stop Loss**: Immediately closes full position upon price crossing SL level.
- **Autopilot vs Manual Control Switcher (`[🤖 Автопілот]` / `[👤 Ручний контроль]`)**:
  - Located on signal page (`signal-live-stage.tsx`) and positions table.
  - In **Manual mode**, automated closures (TP/SL/Trailing) are paused so the trader can observe live prices, let profits run, or exit manually using `50%` or `Close` buttons.
  - In **Autopilot mode**, automated rules resume immediately.
  - Persisted in DB as `trades.trailing_stop.controlMode: "auto" | "manual"` via `toggleTradeControlMode` server action.
- **Dual Execution (Realtime Browser + 24/7 Worker)**:
  - While viewing the signal page, client evaluates ticks every 1.5s via `POST /api/trading/paper-tick`.
  - In the background, `paper-worker.ts` runs 24/7 in Node.js every 3s, ensuring orders execute even if the trader's browser is closed.

### 4.7. Interactive Terminal & Realtime Chart Canvas
- Located in: `apps/web/src/app/dashboard/signal/[id]/signal-chart.tsx` & `signal-live-stage.tsx`.
- **Canvas Chart**: Smooth mouse-wheel zoom, drag-and-drop panning, timeframe selection (`1m`, `5m`, `15m`, `1H`, `4H`, `1D`) with dynamic `/api/market/klines` fetching, and crosshair cursor with OHLCV data.
- **Sub-second Ticker Engine (`useLiveTicker`)**: Connects to public Bybit/Binance WebSocket streams with automatic fallback to 1.5s Ajax polling (`/api/market/ticker`), synchronizing Mark price, PnL, ticker header, and live candle updates.

---

## 5. Database Schema & Migrations Overview

The database resides in Supabase. Migrations are located in `supabase/migrations/`:

1. `202610210001_initial_schema.sql`:
   - `profiles`: User SaaS profiles (free, pro, enterprise).
   - `exchange_accounts`: Holds account connections, encrypted API keys, and environment.
   - `risk_settings`: Per-account risk parameters (max leverage, risk % per trade, max daily loss %, kill switch).
   - `signals`: Raw signal text, parsed JSON payload, status (`preview`, `executed`, `rejected`).
   - `trades`: Active and historical positions, entry price, stop-loss, trailing stop, realized PnL.
   - `orders`: Order execution history, exchange order IDs, deterministic `order_link_id`.
   - `trade_targets`: Multi-target TP tracking (target price, share %, status).
   - `chat_messages`: Realtime signal stream, pulse alerts, and order lifecycle events.
   - `execution_jobs`: Asynchronous queue for trade execution.
   - `audit_log`: Immutable security and operation audit trail.
2. `202610210002_saas_paper_enum.sql`:
   - Adds `paper` to the `exchange_kind` enum.
3. `202610210002_worker_execution.sql`:
   - Worker locking function `claim_execution_job(p_worker_id)` with `FOR UPDATE SKIP LOCKED`.
4. `202610210003_saas_paper_accounts.sql`:
   - Adds `paper_balance` column to `exchange_accounts`.
   - Adds trigger `handle_new_user_paper_account` to automatically create a Vexqora Paper account with 10,000 USDT for every newly registered user.
5. `202610210004_pulse_and_memory.sql`:
   - Realtime publication enhancements for `chat_messages` and indexes for fast ticker lookups.

---

## 6. Environment Variables Reference

### Web Application (`apps/web/.env.local` or Vercel Environment Variables)
```bash
# Public variables exposed to browser
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Server-only variables (never prefix with NEXT_PUBLIC_)
ENCRYPTION_MASTER_KEY=<base64-encoded-32-byte-key>
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
```

### Background Worker (`apps/worker/.env` or Docker/Server Environment Variables)
```bash
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # NEVER expose to browser
ENCRYPTION_MASTER_KEY=<base64-encoded-32-byte-key> # Must match web app!
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... # Optional
TELEGRAM_BOT_TOKEN=...                                   # Optional
```

> [!WARNING]
> Generating a master key:
> ```powershell
> node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
> ```

---

## 7. Required Quality & Verification Commands

Before committing any changes or concluding a working session, run these commands from the repository root:

```powershell
npm run typecheck   # Typecheck all 5 workspaces
npm run lint        # ESLint check
npm test            # Run Vitest test suites (31 unit tests currently)
npm run build       # Next.js Turbopack production build & worker build
```

Expected baseline:
- 0 TypeScript errors.
- 0 ESLint warnings/errors.
- 31 unit tests passing across `@crypto-bot/trading`, `@crypto-bot/exchange`, `@crypto-bot/shared`, `@crypto-bot/worker`.
- Next.js production build completes cleanly.

---

## 8. What is Completed vs What is Next (Roadmap)

### Completed:
- [x] Full Next.js 16 App Router UI with responsive dark-theme design system.
- [x] Multi-account management (Vexqora Paper, Bybit Demo, Bybit Live).
- [x] Automatic 10k virtual USDT onboarding for new signups.
- [x] Signal chat with tab switching (All, Nemotron Signals, Vexqora Pulse).
- [x] Real-time relative timestamps (`formatTimeAgo`).
- [x] Deterministic signal parser (Market, Limit, Range, SL, multi-TP, Trailing Stop).
- [x] Risk calculation engine (position sizing, step normalization, leverage limits).
- [x] Bybit V5 REST client & Paper simulator client.
- [x] OpenRouter Nvidia Nemotron 3 Ultra AI integration.
- [x] Worker queue consumption with `FOR UPDATE SKIP LOCKED`.
- [x] Mode-agnostic executor (`submitEntry`, `protectFilledPosition`).
- [x] Error boundaries and server action fault recovery.
- [x] Worker private WebSocket listener (`order`, `execution`, `position`) with authentication and fill reconciliation.
- [x] Dynamic SL/TP protection placement (`protectFilledPosition`) triggered on limit order fills via WebSocket.
- [x] Real-time Active Positions Dashboard (`/dashboard/positions`) with live mark prices, unrealized PnL ($ and %), and interactive "Close 50%" / "Market Close" / "Close All Positions" server actions.
- [x] Real aggregate daily loss calculation and strict pre-execution rejection in worker `runner.ts`.

- [x] Institutional SMC Quantitative Engine (calculateSMCContext) replacing dummy static formulas with ATR-based SL, multi-timeframe 1D/4H/15m BOS/CHOCH, FVG, and dynamic R:R >= 1:2.0.
- [x] Nvidia Nemotron 3.5 Super VL Vision integration (callNemotronVision & /api/ai/vision-analyze) for TradingView chart screenshot SMC analysis.
- [x] Dual OpenRouter API keys with automatic failover and rate-limit rotation.
- [x] UI Overhaul: Clean, minimalist, institutional feed cards with interactive modal (SignalCard) featuring SMC tabs, mobile copy button, and chart vision scanner.
- [x] High-frequency Bybit universe scanning (Scan Bybit Universe 300+ Pairs) and lowered pulse threshold (1.2% rapid volume expansion).
- [x] Dedicated Signal Terminal Page (`/dashboard/signal/[id]`) with 48h lifecycle archive notice, trade entry fact box, synchronized PnL calculations, and OKX-style layout.
- [x] Interactive Chart Canvas (`signal-chart.tsx`) with dynamic timeframe switching (`1m`, `5m`, `15m`, `1H`, `4H`, `1D`), mouse-wheel zoom, drag-and-drop panning, crosshair cursor with OHLCV data.
- [x] Real-time Public WebSocket & 1.5s Ajax ticker engine (`use-live-ticker.ts`) with sub-second price ticks and live candle updates.
- [x] Pure Paper Matching Engine (`packages/trading/src/paper-engine.ts`) with automated partial TP1 (40%), TP2 (30%), TP3 (30%) fills, virtual USDT balance crediting, and SL protective exits.
- [x] Dynamic Trailing Stop tracking local peak prices after TP1 and market-closing position on 1% pullback.
- [x] Control Mode Switcher (`[🤖 Автопілот]` vs `[👤 Ручний контроль]`) with pause of automated closures and instant manual exit buttons (`50%`, `Close`).
- [x] 24/7 Node.js Background Paper Worker (`apps/worker/src/paper-worker.ts`) monitoring and executing active paper trades even when browser is closed.
- [x] Positions Page (`/dashboard/positions`) enhancements with dual tabs (Active vs Archive) and mode badges (`👤 Ручний`, `🤖 Автопілот`, `⚡ Трейлінг`).

### Immediate Next Tasks (Stage 6):
1. **External Integrations**:
   - Telegram bot webhook to receive signals directly from private channels and push execution confirmations.
   - Discord webhook order notifications.
2. **Production Deployment**:
   - Supabase production migrations & Vercel deployment setup with secure environment variables.

