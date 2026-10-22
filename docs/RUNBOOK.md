# Vexqora Trade — Laptop Setup & Developer Runbook

Follow these instructions to clone, configure, and develop Vexqora Trade on a new machine (laptop).

---

## 1. Prerequisites

Ensure your machine has the following installed:
- **Node.js**: v20.10.0 or higher (`node -v`)
- **npm**: v10.0.0 or higher (`npm -v`)
- **Git**: Installed and configured (`git --version`)

---

## 2. Cloning & Initial Setup

```powershell
# Clone the repository
git clone https://github.com/s1zeNof/Vexqora.git
cd Vexqora

# Install all monorepo workspace dependencies
npm install
```

---

## 3. Environment Variables Configuration

### 3.1. Web Application (`apps/web/.env.local`)
Create a file at `apps/web/.env.local` (or copy from existing configuration):

```env
# Public Supabase connection
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>

# Server-side Encryption Master Key (Base64 32-byte key)
ENCRYPTION_MASTER_KEY=<your-base64-master-key>

# OpenRouter Nemotron 3 Ultra API Key
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
```

### 3.2. Background Worker (`apps/worker/.env`)
Create a file at `apps/worker/.env`:

```env
SUPABASE_URL=https://<your-project-id>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
ENCRYPTION_MASTER_KEY=<your-base64-master-key> # MUST MATCH THE WEB APP KEY!

# Optional notifications
DISCORD_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=
```

> [!TIP]
> If you need to generate a new `ENCRYPTION_MASTER_KEY`:
> ```powershell
> node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
> ```

---

## 4. Running the Development Environment

You will typically run two terminals:

### Terminal 1: Next.js Web Application
```powershell
npm run dev
```
- Available at `http://localhost:3000`
- Turbopack will compile pages dynamically.

### Terminal 2: Background Execution Worker
```powershell
npm run dev:worker
```
- Starts the execution queue listener, startup reconciler, and 24/7 pulse scanner.

---

## 5. Verification Commands (Run Before Any Commit)

Run these 4 commands to verify workspace integrity:

```powershell
# 1. Typecheck all workspaces
npm run typecheck

# 2. Lint check
npm run lint

# 3. Unit tests
npm run test

# 4. Production build test
npm run build
```

---

## 6. Common Issues & Troubleshooting

### Issue: "Supabase public environment variables are missing"
- **Cause**: `.env.local` is missing in `apps/web/` or variables are missing the `NEXT_PUBLIC_` prefix.
- **Fix**: Verify `apps/web/.env.local` contains `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### Issue: "Risk settings not found for account"
- **Cause**: Newly created account without default risk settings row.
- **Fix**: The system automatically generates fallback risk settings (2% risk, 5x leverage), but visiting `/dashboard/risk` will persist custom user settings into the database.

### Issue: Next.js `Minified React error #441` in Server Action
- **Cause**: Uncaught error or invalid redirect inside Server Action.
- **Fix**: Handlers in `actions.ts` must use `try / catch` with `if (isRedirectError(error)) throw error;` so Next.js redirects succeed without triggering error boundaries.

---

## 7. Need Help or Additional Context?
Read `docs/AI_MEMORY.md` and `docs/ARCHITECTURE.md` for complete technical depth.
