# Vexqora — незалежний аудит після D0–D5 (27.10.2026)

**Репозиторій:** https://github.com/s1zeNof/Vexqora  
**Перевірена гілка:** `main` (виявлений HEAD: `02dcea0c1c0e5bcb6338202d76cfa8c03f136c20`)  
**Метод:** статичний аналіз актуальних файлів із GitHub-конектора; НЕ було доступу до Supabase production, Vercel runtime, моделі `.cbm`, журналів запуску чи живих торгових рахунків.  
**Висновок:** наявність нових модулів підтверджено. Твердження «D0–D5 повністю реалізовано й функціонально завершено» поки НЕ підтверджено.

## Блокери / P0

### P0-A. AI Companion видає шаблони замість фактичного AI reasoning
Файл: `apps/web/src/app/dashboard/signal/[id]/ai-companion-actions.ts`, `sendTradeAiMessage`.
Відповіді обираються через `lower.includes("закрити" | "ризик" | "структур")`. Немає виклику LLM, MarketContext, microstructure чи `orchestrateTradeAnalysis` у цьому маршруті. Відповіді заявляють, ніби перевірено стан ризику, 15M тренд і ринок, без отримання відповідних доказів. Це особливо небезпечно для активних угод.
**Fix:** реальний evidence-backed server-side agent orchestration, контроль свіжості даних, відмови за браком даних; no hallucinated safety claims.
**Acceptance:** довільні питання про RSI/structure/news/SL отримують конкретні значення з інструментами й часовими мітками; недоступні дані прямо позначаються.

### P0-B. Новинний статус ONLINE із порожнім списком
Файл: `apps/web/src/app/dashboard/signal/[id]/page.tsx`: `evaluateNewsRiskForTrade(formattedSymbol, [], "ONLINE")`. Модуль `packages/trading/src/news.ts` лише класифікує готові події, але не отримує їх з мережі. Порожня база новин означає **відсутність покриття**, а не «ризиків немає».
**Fix:** реальний collector + провенанс + firstSeen/published timestamps + stale/unavailable -> UNKNOWN. Заборонити optimistic `ONLINE` без перевіреного ingest.
**Acceptance:** без джерела у UI UNKNOWN/UNAVAILABLE; з реальним фідом актуальні події з оригінальним URL і timestamp.

### P0-C. ML provenance все ще підроблюється в HTTP-200 шляху
Файл: `packages/trading/src/ml-bridge.ts`: на будь-яку валідну `HTTP 200` відповідь `/predict` примусово ставить `modelType: "CatBoostClassifier", isFallback:false, status:"OK"`. Але `packages/ml-engine/server.py` повертає `modelType: "StatisticalBayesian"` або `"InsufficientDataFallback"` за відсутності реального навчання/моделі. Успішна HTTP-відповідь не є доказом CatBoost.
**Fix:** строгий runtime schema, read source `modelType`, verify model file/version/feature contract and modelLoaded; unknown or fallback => MODEL_UNAVAILABLE/INSUFFICIENT_DATA (або explicit RULE_HEURISTIC), не "OK".
**Acceptance:** 200+Python fallback НІКОЛИ не відображається як CatBoost.

### P0-D. Немає доведеної гарантії чотирьох гейтів на execution path
Файл: `apps/web/src/app/dashboard/signal/[id]/ai-ensemble-card.tsx` — компонент UI. Потрібно окремо перевірити перед виконанням кожного Bybit/Paper ордера обов'язкові backend-side gates. UI badge не є execution safety.
**Acceptance:** інтеграційні тести blocking NO_TRADE/UNKNOWN у кожному order entry route (включно з API, chat, worker).

## P1 — функціональні прогалини

### P1-A. Фальшивий/неможливий BOS/CHOCH
Файл `packages/trading/src/market-context.ts`, `analyzeTimeframeStructure`: swingHigh та swingLow обчислюються з вікна, що **включає поточну свічку**, після чого перевіряється `lastClose > swingHigh` / `lastClose < swingLow`. Для коректного OHLC `close <= high`, `close >= low`, тож ці умови неможливі. Потрібні *попередні* підтверджені swing high/low без поточного бару, плюс перевірка реальних closed bars.

### P1-B. MTF неповний
Файл `apps/web/src/app/dashboard/signal/[id]/page.tsx` завантажує 25 свічок для 1D та 4H, 35 для 15M; у `market-context` EMA200 вимагає >=200 барів. 1H/5M/1M не заповнюються в цьому шляху. `allCandlesClosed: true` у snapshot задано безумовно. Потрібно щонайменше 200+ **закритих** барів на кожному ключовому TF, пороги stale і поняття missing/insufficient.

### P1-C. Always-On AI — лише події Paper, без live stream у панелі
`apps/worker/src/paper-worker.ts`: `dispatchTradeAiEvent` при TP, SL, trailing. Немає безперервного Agent Scheduler для нових значущих market events. `trade-companion-panel.tsx` отримує `initialSession.messages`, але немає Realtime-каналу, polling або перепідключення; нові події від Worker не видно автоматично, доки UI не оновить серверний стан. Для Live/Demo потрібний окремий інтеграційний шлях.

### P1-D. Agent Runtime не доведено інтегрованим
`packages/trading/src/agent-runtime.ts` містить `orchestrateTradeAnalysis` і детерміністичні skills, проте у фактичному `sendTradeAiMessage` відсутній виклик цього оркестратора. У DB `ai_agent_definitions`/`ai_skill_registry` є реєстрації, які не означають виконання. Присутні жорстко прописані confidence 78/95/70 в Lead synthesis; це **не відкалібровані ймовірності**.

### P1-E. Continuous Learning — класифікатор ≠ навчання
У `signal-outcome.ts` додано `classifyTradeLossRootCause`, але це детерміністичні правила, які не доводять тренування CatBoost з outcome DB. Потрібні ETL, temporal split, versioned ML model registry, calibrated probability та OOS/shadow reports. Зафіксувати атрибуцію помилок як евристичну, поки не підтверджено.

### P1-F. Server-side rendering усе ще створює AI-сесію
`page.tsx` викликає `getOrCreateTradeAiSession()`, який робить `insert trade_ai_sessions` і initial `trade_ai_messages` під час GET. Отже, повністю read-only сторінка досі не є read-only, хоча раніше фінансові мутації були вилучені. Краще ініціалізувати через idempotent RPC/job/action на відкритті позиції; забезпечити dedupe і unique constraints.

## SQL-інцидент

Файл `supabase/COMPLETE_ALL_IN_ONE_SETUP.sql` непридатний для повторного застосування до існуючої prod-схеми як загальна «ідемпотентна» міграція: `CREATE TABLE IF NOT EXISTS` не ремонтує відсутні колонки; змішані історичні міграції повторно створюють тригери, політики, створюють Paper-акаунти та засівають непідтверджені результати історичних патернів. Помилка `42703 account_id` указує на drift таблиці, але без фактичної інформації `information_schema` не відомо, яка саме.

**Підготовлено:**
- `VEXQORA_SQL_SCHEMA_DIAGNOSTICS.sql` — read-only діагностика.
- `VEXQORA_AI_SCHEMA_SAFE_INCREMENTAL_FIX.sql` — транзакційна вузька міграція лише семи AI-таблиць зі спробою безпечного відновлення колонок, RLS та перевірки власності.

**Порядок:** backup Supabase -> діагностика -> якщо всі core-колонки OK, застосувати інкрементальну AI-міграцію -> перевірити RLS/індекси/доступ із реального auth-користувача -> інтеграційне тестування.
**Заборонено:** TRUNCATE / DROP core tables, перерахунок балансів або seed демонстраційних даних у prod.

## Acceptance suite для агента

1. SQL виконується на копії *реальної* схеми з історичними/частково застосованими міграціями і повторно без помилок.
2. Користувач А не може переглянути чи змінити сесію користувача Б.
3. Trade Companion відповідає довільними обґрунтованими даними, використовує реальні інструменти й журналює run/tool-call; при offline/відсутності даних чесно відмовляє.
4. Без відкритої вкладки фонова система створює події; з відкритою вкладкою вони з'являються автоматично через Realtime.
5. Сервер повертає `MODEL_UNAVAILABLE` для Python fallback навіть за `HTTP 200`.
6. MTF unit test знаходить реальний BOS на штучній, але валідній OHLC-послідовності.
7. Прогнози після кожної loss-угоди не називаються «навченими» без фактичного retrain та out-of-sample тестів.
8. Всі старі керування угодами залишаються функціональними; жодна тестова операція не має відправляти live ордер.
