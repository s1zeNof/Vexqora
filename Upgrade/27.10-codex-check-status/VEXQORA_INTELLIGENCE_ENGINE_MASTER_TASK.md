# VEXQORA INTELLIGENCE ENGINE — MASTER DEVELOPMENT SPECIFICATION

> **Для:** AI-розробника Vexqora (Codex / Claude / інший coding agent)  
> **Дата аудиту:** 27 жовтня 2026  
> **Репозиторій:** https://github.com/s1zeNof/Vexqora  
> **Базовий перевірений стан:** `main`, commit `8f12d27b1a5b95c0ff2fcbc4261734030f7d8f2a`  
> **Пріоритет:** виправлення достовірності та безпеки → реальний ML/data intelligence → full-width trade terminal → активний per-trade AI → multi-agent platform → безперервна перевірювана система навчання.  
> **Статус:** технічне завдання; не є свідченням того, що production, БД, моделі або live trading уже перевірені.

---

## 0. Прочитати перед початком роботи

Ти — AI-розробник Vexqora. Це **послідовне завдання на розвиток наявного продукту**, а не дозвіл переписати застосунок з нуля. Автор проєкту хоче максимально розвинену AI-native trading intelligence system, але **без втрати жодної чинної функції**, зокрема керування угодами, реального/демо/paper виконання, SL/TP, trailing, графіків, історії, позицій, risk limits, користувацьких налаштувань та автентифікації.

### Основні принципи (non-negotiable)

1. **Спочатку виправ помилки P0**, потім додавай великі можливості. Не ховай баги під новими UI-компонентами.
2. **Не руйнуй працюючі шляхи виконання угод**: Paper / Bybit Demo / Bybit Live. Відокремлюй аналітику від незалежного deterministic risk/execution gateway.
3. **Нічого автоматично не відкривай, не закривай і не змінюй на реальному рахунку** тільки тому, що LLM так написала. За замовчуванням live-дії потребують явного підтвердження користувача. Обов'язкові protective exchange-side SL/TP мають працювати незалежно від AI.
4. **Не вигадуй ринкові дані, свічки, win rates, новини, результати backtest, ML probabilities чи повідомлення про нібито виконані agent tools.** Якщо немає даних — `UNKNOWN`, `UNAVAILABLE`, `STALE`, `NO_TRADE` або чесний degraded mode.
5. **Немає гарантії прибутку.** Ціль — зменшити необґрунтовані рішення, отримати відтворювану, статистично перевірену перевагу і прозору систему ризиків.
6. **Нові ML-моделі не повинні автоматично підміняти production-модель після одного лузу.** Потрібні незалежне тестування, shadow mode, candidate/champion deployment, версії та rollback.
7. **Не виконувати небезпечні мутації під час server render / GET / простого перегляду сторінки.** Будь-яка зміна ордерів, PnL або балансів — окремий авторизований, аудитований, ідемпотентний workflow.
8. **Без прихованої заміни біржових даних статичними значеннями.** Fallback-сигнал, якщо взагалі допустимий, повинен бути чітко позначений як не-ML і не видавати себе за calibrated probability.
9. Працюй **по фазах і невеликих PR** із регресійними тестами, описом міграцій та rollback. Не роби один великий ризикований коміт.
10. ПЕРЕД будь-якими змінами перечитай актуальний `main`/`AGENTS.md`, перевір, що з цього документа вже реалізовано після зазначеного коміту, і не дублюй нові рішення. Не змінюй функції тільки для відповідності цьому документу, якщо вже існує краща перевірена реалізація.

### Обов'язкова початкова перевірка

- Знайди версію поточного `main`, порівняй з `8f12d27b...`.
- Прочитай `AGENTS.md`, `README.md`, `docs/AI_MEMORY.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, усі відповідні `supabase/migrations`.
- Запусти: `npm ci` (у відповідному середовищі), `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Запиши фактичні результати; не заявляй «успішно», якщо не запускав.
- Окремо перевір Python ML dependencies, чистий `venv` та інтеграційний API test. Запиши версії Python/CatBoost/FastAPI.
- Підготуй **baseline behavior checklist** для Paper, Demo та Live (live без фактичної торгової операції): входи, виходи, partial TP1/2/3, trailing, manual/auto, order status, комісії, баланс, історія, сигнал, графік, auth/RLS.
- Для всіх висновків надай **джерело: file:line, тест, SQL-вибірку або production-log**. Якщо доступу до Supabase чи Worker немає — явно напиши, що підтверджено лише статично кодом.

---

# PHASE P0 — КРИТИЧНІ ВИПРАВЛЕННЯ ТА ДОСТОВІРНІСТЬ

## P0.1. Виправити некоректний RSI у Python ML

**Файл:** `packages/ml-engine/features.py`  
**Знайдене в базовому коміті:** `calculate_rsi()` після початкового періоду додає неповну кількість значень: для 30 свічок повертається приблизно 17 значень замість 30. `extract_candle_features()` індексує RSI по всіх барах → можливий `IndexError` і падіння навчання/inference.

### Зробити

- Написати коректну реалізацію RSI(14) із послідовним Wilder smoothing та масивом довжини `N`.
- Визначити чітку політику warm-up: `null/NaN` у внутрішніх розрахунках або явна маска неготовності, **без** фальшивого «RSI=50» як реальної виміряної ознаки.
- Забезпечити узгоджену довжину кожного feature array та правильну поведінку при 0, 1, 13, 14, 15, 30, 200, 300 барах.
- Перевіряти відсутність `NaN`, `Infinity` у векторах inference і training; не замінювати їх мовчки довільними числами.
- Додати unit-тести на висхідний/спадний тренд, константні ціни, коротку історію, коректність індексів, збіг із еталонним RSI на контрольній вибірці.

**Acceptance:** `extract_candle_features()` працює на реальних 300+ OHLCV без помилки; усі масиви вирівняні; ML API повертає валідний, відтворюваний результат для правильних даних.

## P0.2. Уніфікувати контракт OHLCV/таймстампів

**Файли:** `packages/data-lake/src/types.ts`, `storage.ts`, `bybit-klines-downloader.ts`, `packages/ml-engine/features.py`, `train_catboost.py`, `server.py`, `packages/trading/src/ml-bridge.ts`, `packages/exchange/src/klines.ts`.

**Знайдене:** Data Lake використовує `timestamp`, а Python features читає `time`; часові features (`hour_sin`, `hour_cos`) можуть отримувати timestamp=0.

### Зробити

- Єдиний canonical candle schema: `symbol`, `exchange`, `marketType`, `timeframe`, `openTimeMs`, `closeTimeMs`, `open`, `high`, `low`, `close`, `volume`, `turnover`, `isClosed`, `source`, `receivedAtMs` (з адаптерами для нинішніх контрактів).
- Узгодити timestamp naming у TypeScript і Python; опублікувати schema fixtures/contract tests.
- Перевіряти порядок за часом, timezone UTC, дублікати, прогалини, нульові й від'ємні значення, `high >= max(open,close)`, `low <= min(open,close)`.
- Для feature extraction використовувати лише інформацію, **доступну на момент сигналу** (закриті свічки або явно позначений інтрабарний режим).
- Не розділяти поїзди/тести випадковим shuffle; усунути leakage від майбутніх OHLC, multi-timeframe alignment та revision.
- Зберігати data quality report: symbol/timeframe, covered interval, gaps, duplicate count, last event time, source freshness, usable bars.

**Acceptance:** один ринковий snapshot дає ідентичні індикатори незалежно від того, чи читається він із Bybit live чи Data Lake; timezone/UTC і shift відтворювані.

## P0.3. Прибрати помилкове уявлення, що heuristic fallback — справжній ML

**Файли:** `packages/trading/src/ml-bridge.ts`, `packages/ml-engine/server.py`, `train_catboost.py`, `apps/web/src/app/dashboard/signal/[id]/ai-ensemble-card.tsx`, `packages/trading/src/nemotron.ts`.

**Знайдене:** bridge використовує hardcoded `http://127.0.0.1:8000/predict` і таймаут 350 ms. Для Vercel localhost **не є домашнім ПК**. Якщо ML-server не працює, використовується `calculateAdaptiveConfidence()` та label `AdaptiveQuantitativeBayesian`. У Python також є heuristics, якщо не знайдено `.cbm`.

### Зробити

- Додати налаштований `ML_SERVICE_URL`, підписаний внутрішній доступ, health/readiness endpoint, timeouts/retries/circuit breaker, audit latency, надійний розподіл між training host та inference host.
- Обрати відповідний hosting для inference, доступний 24/7 і незалежний від того, увімкнений домашній ПК чи ні. Комп'ютер користувача можна використати для навчання, але не як single point of failure protective trading.
- Розрізняти `CATBOOST_TRAINED`, `STATISTICAL_BASELINE`, `RULE_HEURISTIC`, `INSUFFICIENT_DATA`, `MODEL_UNAVAILABLE`, `ERROR`.
- Не виставляти `P(TP before SL)` як calibrated probability, якщо модель не пройшла calibration validation.
- У кожній ML-відповіді: `modelId`, `modelVersion`, `modelType`, `trainedAt`, `trainingPeriod`, `sampleCount`, `sourceDatasetVersion`, `featureSchemaVersion`, `calibrationStatus`, `latencyMs`, `isFallback`, `missingFeatures`, `dataAsOf`.
- Якщо справжньої моделі немає, робити risk-first degraded mode (`NO_TRADE` або явно відокремлений rule-based analysis), а не удавати успішний ML Gate.
- На сторінці угоди та в сигналі показувати походження confidence: LLM rationale vs statistical probability vs heuristic score — різні поняття.
- Заборонити моделі підміняти рішення deterministic Risk Engine. Недоступна модель не повинна пропускати небезпечний live trade.

**Acceptance:** у тесті із зупиненим Python inference сервісом UI та API чітко показують `MODEL_UNAVAILABLE`/fallback, **не** «CatBoost confirmed», і зберігають всі protective controls.

## P0.4. Реальне навчання, а не synthetic calibration як доказ прибутковості

**Файли:** `packages/ml-engine/train_catboost.py`, `labeling.py`, `server.py`, `packages/data-lake/*`.

**Знайдене:** коли `data/klines/15m/<SYMBOL>.json.gz` відсутній, trainer створює синтетичні candles. За замовчуванням `__main__` тренує BTCUSDT long/short, не весь universe. Твердження про «48+ features» не відповідає 18 назвам у `FEATURE_NAMES` на перевіреному коміті.

### Зробити

- За замовчуванням **заборонити тренувати production model на синтетичних даних**. Синтетика дозволена лише для unit/integration tests під `TEST_ONLY`.
- `train` має явно відмовлятися, якщо немає достатньої реальної історії або джерела ненадійні.
- Feature registry відображає **фактичну**, а не рекламну кількість features.
- Додати конфігурований per-universe training pipeline (не хардкод тільки BTC) із кількістю прикладів, coverage і контролем якості.
- `triple_barrier_labeling`: перевірити conservative same-bar TP/SL tie policy; реальні комісії, funding, spread, slippage; мітки з `NO_TRIGGER`/expired окремо від loss, якщо це потрібно стратегії.
- Тренувальні splits: chronological walk-forward, purge/embargo для overlapping labels, independent out-of-sample, калібрування probabilities на окремій валідації.
- Всі артефакти моделі зберігати в registry, з checksum, feature schema, training manifest, metrics, promotion/rollback.
- Ввести мінімальні gates для публікації моделі, але **не придумувати бажаний win rate** наперед: Brier/log loss, reliability curve, precision/recall по actionable signals, EV net of costs, max drawdown, trade count, robustness across regimes.

**Acceptance:** агент показує репродукований запуск на **реальних** даних із datasets manifest, журналом тренування, тестовою статистикою, артефактом `.cbm` і правильним inference через production-consumable endpoint; не називає неперевірений baseline «навченим».

## P0.5. Перевірити learning feedback і точність результатів сигналів

**Файли:** `apps/worker/src/signal-monitor.ts`, `packages/trading/src/signal-outcome.ts`, `packages/trading/src/ai-learning.ts`, `supabase/migrations/202610230002_canonical_signals_and_learning.sql`.

**Знайдене:** Worker записує `signal_outcomes` та `signal_learning_events` (MFE, MAE, SL, TP). Але `train_catboost.py` зараз **не читає** цю історію, а loss count використовується як жорстко прописаний penalty. Поточний моніторинг за snapshot останньої ціни раз на ~10 секунд може пропускати внутрішньоінтервальні дотики до SL/TP.

### Зробити

- Розділити три процеси: (1) збір фактів, (2) post-mortem/labeling, (3) контрольоване retraining. Не заявляти «самонавчання» лише через запис подій.
- Для верифікації TP/SL використовувати біржові fills/positions/order events і/або історичні high/low чи tick trades. Розв'язувати неоднозначність порядку TP/SL за conservative policy та позначати її.
- Зв'язати prediction snapshot з `signal_id`, `trade_id`, `account_id`, `modelVersion`, `featureSnapshotId`, entry intent/execution, exit reason та фактичним PnL net of fees.
- Розрізняти: неправильно спрогнозований напрям; прогноз напряму правильний, але поганий SL; slippage; data gap; невдала логіка trailing; ручне втручання; несправність Worker/API; політика ризику.
- Замість «2 програші на цій монеті = мінус 18%» у майбутньому використовувати надійний контекст (side, regime, volatility, timeframe, strategy, sample size); до цього явно маркувати евристику.
- При перевірці історичних помилок не змінювати історичний запис так, щоб покращити backtest метрики заднім числом.

**Acceptance:** audit trail одного сигналу дозволяє відтворити, які дані агент бачив на момент рішення, що реально трапилось і чи пішла подія в тренувальну вибірку; окремо доказано, що нова модель перевірена перед deployment.

## P0.6. КРИТИЧНО: прибрати data mutation із server-render сторінки угоди

**Файл:** `apps/web/src/app/dashboard/signal/[id]/page.tsx`  
**Базові орієнтири:** ділянки ~286–401+ містять auto-repair історичних угод для `QUSDT`, `BLEND`, `BIRB` з hardcoded exit price/PnL та коригуванням `paper_balance` під час рендеру.

### Зробити

- Перед зміною зняти audit: які записи в `trades`/`exchange_accounts` могли бути змінені; скільки разів; які поля і суми; чи можливе повторне нарахування. Без production доступу не робити висновків про фактичний збиток.
- Винести виправлення в контрольовану операторську процедуру/migration/reconciliation, тільки за доказовими exchange snapshots/ledger events, з idempotency key і транзакцією.
- GET/render сторінки — **read-only** щодо trades, realized PnL, order status, paper balance.
- Розробити append-only ledger / audit record для всіх змін віртуального балансу, бажано transactional RPC із блокуванням конкурентних оновлень.
- Забезпечити, що reconciliation не може переписати live історію за фіксованими цінами/значеннями.
- Перевірити `apps/web/src/lib/paper-repair.ts`, `paper-service.ts`, `apps/worker/src/paper-worker.ts`, race conditions між browser tick і worker, stale ticker anomalies, partial fills, rounding та atomic settlement.
- Не видаляй із production дані чи попередні корекції без погодженого migration/recovery плану.

**Acceptance:** 10 повторних відкриттів одного trade URL не змінюють баланс/PnL/ledger. Реконсиляція повторюється ідемпотентно; всі попередні repairs мають provenance; тест на конкурентний tick/settlement проходить.

## P0.7. Не відображати синтетичний ринок як live market

**Файли:** `apps/web/src/app/dashboard/signal/[id]/signal-chart.tsx` (fallback «synthetic candles» ~234–249), `packages/trading/src/pulse.ts` (жорстко прописані fallback-пари й котирування), `packages/trading/src/ai-copilot.ts` (fallback SMC), `packages/trading/src/memory.ts`.

### Зробити

- На реальному графіку, якщо дані недоступні, показувати `Market data unavailable / retry`, last valid snapshot + timestamp; **не** генерувати придумані свічки.
- Fake fallback symbols/prices допустимі лише в демо-режимі, чітко поміченому `DEMO_FIXTURE`, ніколи в реальному сигнальному потоці.
- У `memory.ts` `isEmpirical: false` має **забороняти** подавати hardcoded `sampleCount`, `winRatePct` як підтверджену історію.
- Не писати «1D confirmed»/«4H verified», коли немає відповідних даних. Невизначеність має бути першокласним станом.
- Для новин — не генерувати заголовки, URLs, timestamps або market-moving explanations, якщо немає зовнішнього підтвердженого джерела.

**Acceptance:** при збої всіх ринкових API жодний live UI або AI response не показує вигадані ціни, свічки, historical results чи новини.

## P0.8. Виправити AI Ensemble Gates і backend enforcement

**Файл:** `apps/web/src/app/dashboard/signal/[id]/ai-ensemble-card.tsx` та пов'язані risk/execution paths.

**Знайдене:** за відсутності microstructure використовуються OBI/CVD = 0, що може виглядати як PASS; за відсутності ML у UI є fallback `mlEV = 14.5`. UI Gate не тотожний обов'язковій перевірці перед реальним ордером.

### Зробити

- Стандартизувати verdicts: `PASS`, `FAIL`, `UNKNOWN`, `STALE`, `ERROR`, `NOT_APPLICABLE`; кожен із timestamp/evidence/provenance.
- Відсутність ML або order book не означає «безпечний / позитивне EV». Заборонити фіктивні значення типу `14.5`.
- Decision pipeline на backend: `candidate` → data quality gate → structural/regime checks → true ML/risk checks → execution preflight → explicit authorization.
- До реальної подачі ордера сервер перевіряє права доступу, symbol status, tick/qty precision, slippage, funds, max exposure, daily loss, kill switch, leverage, risk %, idempotency.
- Не довіряти `qualityScore` або `decision`, отриманим тільки із браузера/LLM. `NO_TRADE` — допустимий і пріоритетний висновок.
- Не підвищувати self-reported LLM confidence до статистичного probability. Probability має приходити з каліброваного ML, із вказаним метаданими станом.
- Тести: будь-який fail/unknown critical gate не може перетворитися на live submit через інший UI/route.

**Acceptance:** UI відображає той самий централізований execution eligibility verdict, який перевіряє backend; неможливо обійти gate прямим API-запитом.

## P0.9. Regression & safety lock

До початку наступних фаз — окремо перевірити:

- Multi-account isolation, RLS та `service_role` secrets only on backend;
- Bybit V5 execution, orderLinkId idempotency, stop orders, restart/reconnect/recovery;
- Paper/Live behavior parity where appropriate; не вважати Paper fills еквівалентом live slippage;
- Partial TP allocations, manual mode, trailing after TP1, stop priority, funding/fees;
- Coin-specific tick size, minNotional, qty precision, stale/incorrect ticker spikes;
- Manual action has precedence/authorization; no double settlement;
- Unit/integration/regression tests + recorded minimal E2E; observability for missing ML/models.

**P0 EXIT GATE:** не починати автономні AI action flows, доки критичні P0 не вирішено або явно ізольовано; будь-яке виключення оформити окремим ризиковим рішенням.

---

# PHASE P1 — VERIFIED MARKET INTELLIGENCE & REAL ML

## P1.1. Повне покриття universe, включно з «помірними» монетами

**Поточний стан:** `packages/trading/src/pulse.ts` має `balanced/moderate/momentum/volatile`; moderate визначається переважно `abs(change24hPct) <= 5%` із сортуванням за turnover. Pulse опитує Bybit linear ticker universe, але deep-dive здійснюється для обмеженої кількості аномалій (`anomalies.slice(0,3)` у базовій реалізації). `apps/web/src/app/api/market/scan/route.ts` генерує лише обраний shortlist.

### Вимоги

- Залишити event-driven anomaly scanner, **паралельно** додати `Structure Opportunity Scanner` для ліквідних пар зі спокійним 24h рухом, але якісною MTF-структурою.
- Кандидати з усіх **eligible та доступних для торгівлі** Bybit USDT perpetual, з чітким coverage report (universe size, scanned, skipped, stale, rejected, reasons). Не трактувати «all pairs» як безконтрольну кількість дорогих LLM-запитів.
- Розділити: **L0** broad inexpensive tickers/features для всього universe; **L1** OHLCV + derivatives; **L2** Order Book/Trades; **L3** ML inference; **L4** LLM reasoning лише для shortlist.
- Ранжування за structure quality, liquidity, spread, volatility regime, momentum *і* mean-reversion opportunity, volume anomaly, OI change, correlation with BTC/ETH, expected trading costs.
- Пріоритет не тільки magnitude 24h move. Приклад: невеликий рух, але підтверджений 4H trend / 1H pullback / 15M BOS / 5M trigger — повинен потрапити до оцінки.
- Зберегти `moderate/momentum/volatile/balanced`, але додати `structure`, `early_trend`, `range_breakout`, `mean_reversion` або інші потрібні обґрунтовані категорії.
- Контролювати per-symbol cooldown, API rate limits, dedup, fair scheduling і спеціальні обробки делістнутого/зупиненого символу.
- Усі потенційно цікаві кандидати мають отримати **детермінований** результат (`accepted / rejected / insufficient data`) і reason, навіть якщо LLM не викликалася.

**Acceptance:** за контрольним датасетом є валідний moderate-setup із 24h зміною <2%, який знаходить Structure Scanner. Dashboard відображає coverage, причини пропусків та джерела даних.

## P1.2. Справжній Multi-Timeframe (MTF) Intelligence

**Поточний стан:** UI графіка підтримує `1m/5m/15m/1H/4H/1D`, але Nemotron та Pulse отримують здебільшого коротку історію `15m`; при цьому LLM має поля `smc1D` і `smc4H`.

### Зробити

- Єдиний `MarketContextSnapshot` для кандидатів: `1D`, `4H`, `1H`, `15M`, `5M`, а `1M` для точного виконання shortlist (і опціонально 1W, якщо є потреба).
- Для EMA200 на певному ТФ забезпечити достатню історію: щонайменше 200 закритих свічок + warm-up buffer, рекомендовано 250–300+; не використовувати 15–25 свічок для висновків щодо EMA200 або macro-trend.
- Збирати технічні features на кожному ТФ, timestamp та data quality; в одній відповіді давати структурований summary, а не сирі тисячі свечок у prompt.
- Виявляти trend/range/transition/high-vol regime, swing highs/lows, BOS/CHOCH/FVG/order blocks з об'єктивними правилами; підтвердження різних ТФ має включати конфлікти, а не лише «all bullish».
- Запровадити «evidence-required» responses: якщо 4H недоступний, `4H: UNKNOWN`, а не generated analysis.
- MTF features використовуються і ML, і Nemotron, і в per-trade AI-чаті за одним data contract.
- Обережно з unfinished candles, UTC alignment, caching і timestamp skew між API.

**Acceptance:** для кожного виданого сигналу можливо переглянути as-of snapshot на всіх потрібних ТФ та відтворити причини LONG/SHORT/WAIT/NO_TRADE.

## P1.3. Єдиний Indicator / Feature Registry

**Поточний стан:** `packages/ml-engine/features.py` містить приблизно **18 названих features**, включно з `rsi_14`, EMA 9/21/50/200 diff, MACD histogram, Bollinger `%B`/bandwidth, ATR%, volume ratio, candlestick wick/body, returns, hour cycle. Частина інших структурних ознак — у TypeScript (`ai-copilot.ts`, `microstructure.ts`).

### Рішення

- Розробити `FeatureRegistry` / `IndicatorRegistry`: `id`, `version`, `timeframe`, required bars, inputs, calculation code owner, data source, output schema, warm-up, freshness TTL, deterministic tests, cache policy, permissions.
- Базовий набір: RSI, EMA/SMA, MACD, ATR, Bollinger Bands, raw/relative Volume, RVOL, VWAP, OBV, ADX, Stochastic, volatility percentile, rate of change, market structure swings, orderbook imbalance, CVD, OI delta, funding, spread, liquidity stress, BTC/ETH correlation, relative strength. Додавати лише за перевіреної цінності, без feature bloat.
- Узгодити обчислення Python та TS: вибрати canonical implementation або shared test fixtures; не допускати різних RSI/EMA для одного й того ж snapshot.
- Індикація в UI: джерело, значення, час, якість і де модель використала features.
- Агенти можуть **викликати зареєстровані tools** та пропонувати нові індикатори через окремий coding workflow/PR, але **не** самостійно виконувати неперевірений згенерований код із production-секретами.

**Acceptance:** однаково визначені features для будь-якого агента й моделі; новий індикатор підключається через versioned contract і тести, а не копіювання окремих формул у prompts.

## P1.4. Market microstructure, Whale, Derivatives, Liquidations

**Поточний стан:** є `packages/exchange/src/microstructure.ts`, `packages/trading/src/microstructure.ts`: Order Book, public trades, rolling-ish tape calculations, OBI, CVD over fetched recent trades, large trades, OI, squeeze classification. Pulse deep-dive забирає обмежені snapshots. Funding у викликах `evaluateMarketMicrostructure()` часто не подається, тому за default може бути 0.

### Зробити

- Розділити **snapshot CVD** (на вибірці останніх N trades) та **time-series CVD** (накопичений/віконний потік) — не називати перше повноцінним historical CVD.
- Для Order Book: depth, imbalance across levels, wall persistence, spoofing indicators (обережна інтерпретація), spread, top-of-book, slippage estimates, liquidity gaps; з часовими мітками.
- Для «whale activity» чесно визначати threshold і подію. Великий public trade ≠ підтверджена ідентичність кита/намір. Не видавати on-chain flows без on-chain джерела.
- OI, funding, liquidation потокові/історичні дані через надійні біржові джерела; відсутній funding позначати unknown, не 0.
- Моніторити exchange-specific liquidations, order book disruptions, spread expansions і моменти підвищеного execution risk.
- Не зливати кросбіржові показники як однакову ліквідність: source/exchange та contract metadata обов'язкові.
- Додати алерти на data gaps/staleness, reverse order, API degradation.

**Acceptance:** microstructure agent отримує реально свіжий пов'язаний snapshot; якщо джерело відсутнє, відповідна метрика не «нейтральна за замовчуванням», а unknown.

## P1.5. News & Event Intelligence — новий підсервіс

**Статус аудиту:** окремого повноцінного ingestion/monitoring news pipeline у поточному дереві файлів не виявлено.

### Джерела/види подій (реалізувати з адаптерами та доступними ліцензіями)

- Офіційні біржові announcements: listings/delistings, maintenance, perpetual contract changes, margin/leverage policy.
- Офіційні token/project announcements, GitHub/security incidents, token unlock calendars.
- Підтверджені high-impact макроекономічні календарі (CPI, FOMC, ставки, рішення регуляторів), exchange incidents.
- Ліцензовані RSS/News APIs/social monitoring, де дозволено доступ; не scrape-ити без урахування умов провайдера.

### Pipeline

`Source Poll/Push → Normalize → Verify/Deduplicate → Entity/Symbol Resolve → Classify Impact → Store → Dispatch Event → AI Explanation`.

- `news_event_id`, `source_url`, `source_type`, `published_at`, `first_seen_at`, `received_at`, `symbols`, `event_type`, `verification_status`, `confidence_in_relevance`, `impact_level`, `source_coverage`.
- News Agent не має вигадувати заголовки/посилання або стверджувати, що «усі новини» перевірено.
- Якщо новина суттєва, переоцінити affected watchlist/trades через єдиний decision pipeline, але не відкривати/закривати позицію лише на основі неперевіреного заголовку.
- Інформацію про новини показувати в Trade Companion та на картці сигналу із посиланням і часом.

**Acceptance:** фіктивний тестовий exchange-announcement event проходить дедуплікацію й потрапляє тільки у релевантні sessions; кожний висновок має посилання на джерело. Якщо news ingestion offline — UI показує `news coverage unavailable`.

## P1.6. Справжня Historical Memory

- Залишити static SMC pattern recognition як **heuristic detection**, але відокремити від **empirical historical results**.
- `isEmpirical: false` → заборонити трактувати sampleCount/winRate як факти у prompt/UI.
- Створити event store із історичними snapshots/features/outcomes; аналоги шукати за режимом, таймфреймом, volatility, volume, OI, BTC context, side, liquidity та часовою близькістю інформації.
- Показувати `N comparable cases`, dates/ranges, win/loss/no-trigger, median return, confidence intervals, leakage safeguards; мала вибірка позначається як слабка.
- Передати verified historical context ML і Lead Agent; наявність схожих ситуацій — лише evidence, не гарантія успіху.

**Acceptance:** ізоляція train/test по часу; за відсутності реально перевірених аналогів система прямо пише «немає достатньої історії», а не вигадує 70% win rate.

## P1.7. ML research та backtesting як вимірюваний процес

- Розширювати Data Lake по universe/timeframes; coverage, quality, rate limiting, storage budgeting і incremental updates. Фактичний storage нині `json.gz`; не називати Parquet, доки не реалізовано.
- Об'єднати market features, historical news (тільки as-of), signal prediction snapshots, виконання trades і verified outcomes.
- Моделі: почати з CatBoost/LightGBM baseline vs stronger model; окремі задачі `P(TP1 first)`, `P(SL first)`, `expected net return`, `MFE/MAE`, `market regime`; не замінювати однаковою probability все.
- Backtest має моделювати latency, order types, min tick/qty, maker/taker fees, spread, slippage, funding, intrabar ambiguity, partial TPs, trailing та manual changes; слід окремо відобразити обмеження tick vs candle simulation.
- Performance dashboard: EV/trade після всіх витрат, profit factor, drawdown, Sharpe/Sortino (з коректним time basis), calibration, Brier/log loss, win-rate bands, sample counts і stratification by market regime/timeframe.
- Модель не можна промотувати лише за високою accuracy або однією прибутковою добою. Додати challenger/shadow deployment, feature drift/data drift monitors, rollback.

**P1 EXIT GATE:** кожен сигнал має реальний verified market snapshot, явні якість/походження даних і чесну модельну provenance. Moderate opportunities реально скануються; news coverage заявляється лише в межах підключених джерел.

---

# PHASE P2 — FULL-WIDTH TRADE TERMINAL (UI/UX REDESIGN, БЕЗ ВТРАТ ФУНКЦІЙ)

## P2.1. Загальна ціль

Переробити наявну сторінку `apps/web/src/app/dashboard/signal/[id]/...` у **full-width professional trading terminal**. Для щільної композиції орієнтуватися на торгові термінали на кшталт pump.fun, **але не копіювати дизайн 1:1**. Зберігати власні кольори Vexqora, існуючі компоненти й взаємодії. Новий AI Companion буде постійно видимою частиною цієї ж сторінки, а не окремою route/page.

### Виявлений поточний constraint

`apps/web/src/app/dashboard/signal/[id]/page.tsx` має `maxWidth: "1232px"` у root wrapper; `signal-live-stage.tsx` використовує `signal-layout` / `signal-stage` / `signal-panel`. Переробляти **локальний layout термінала**, не глобальний dashboard shell без потреби.

## P2.2. Desktop layout

Рекомендована CSS Grid-система для wide screens (>~1440px):

- Верхня смуга: symbol, pair/exchange, direction, mark price, price change, market status, model/data status, latency.
- Основна область: **Chart ~50–60%**, **Execution & Position ~18–23%**, **AI Trade Companion ~23–30%**; з адаптивними min widths та drag-to-resize (не обов'язково MVP).
- Нижній workspace з табами: `Open Orders`, `Active Positions`, `Order History`, `AI Ensemble`, `Market Structure`, `Order Flow`, `Backtest`, `News`, `Agent Activity`, `Audit Log`.
- Всі наявні дані залишити доступними, навіть якщо їх розмістити у вкладках/accordion; не приховувати критичні SL, ліквідацію чи kill switch.
- Chat panel sticky/resizable; ручне повідомлення може відкрити related tool result / event без перезавантаження графіка.
- Terminal layout повинен бути сумісним з відеокартами/ноутбуками та браузерами без надмірного rerender на WebSocket price tick.

## P2.3. Tablet/mobile

- Tablet: chart + execution, AI Companion collapsible side drawer або нижня вкладка.
- Mobile: top trade status, responsive chart, швидкодоступні position controls, таби `Chart / Trade / AI / Insights`.
- Статус AI-повідомлень і важливі risk alerts доступні навіть коли AI-чат неактивна вкладка.
- Перевірити keyboard, scroll, sticky, resize, aria labels, loading/stale states.

## P2.4. Preservation checklist (не видаляти)

- Існуючий chart zoom/pan/timeframes/crosshair/price markers та live ticker.
- Entry, Market/Limit, margin, leverage, size, position status, PnL, liquidation/risk, balance.
- SL, TP1/TP2/TP3, часткове закриття, trailing, режим Manual/Autopilot, close 50%/100%.
- Signal explanation, AI Ensemble, microstructure, historical context, archive/history, actions, trading mode badges.
- Paper/Demo/Live, sound/toasts, authenticated routes, user-specific RLS.
- Error/loading states; user choices; hidden but accessible legacy functions.

**Acceptance:** візуальний regression inventory «old → new location» для **кожного** елемента та screenshots desktop/tablet/mobile. Behavior E2E до/після без регресії execution.

---

# PHASE P3 — ALWAYS-ON PER-TRADE AI COMPANION

## P3.1. Продуктова модель

**Vexqora Trade Companion** живе в межах **кожної конкретної угоди** (або відокремленого signal preview без відкритої угоди). Не створювати загальну розмову без прив'язки до trade. Якщо за одним signal є кілька позицій/рахунків, пам'ять, права доступу і події повинні розмежовуватись за `accountId + tradeId`, не тільки `symbol`.

- Користувач може писати в AI-чат і запитувати аналіз, варіанти дій, ризики, historical analogs.
- AI працює **на подіях без user messages**: входи, fills, TP/SL, трейлінг, важливі зміни orderbook, structure, OI/funding, новини, ризики, market regime shift.
- AI зберігає пам'ять про **початкову торгову тезу**, історію змін і рішень, викликані підлеглі tools та докази.
- AI у повідомленнях пише правду: `observed`, `computed`, `inferred`, `recommendation`, `action requested`, `action approved`, `action executed`, `failed` — різні статуси.
- Чат не повинен ставати механізмом непомітного live trading: ризикові дії виконуються лише згідно з прописаним authorization policy.

## P3.2. Приклади event-driven повідомлень (не hardcoded «розумні» фрази)

- `Trade opened`: «Позицію відкрито. Зафіксував фактичний fill, SL/TP, rationale, model versions і snapshot».
- `Structure update`: «15M bullish залишається, але 5M структура ослабла; перевірено о ... UTC».
- `Order flow shift`: «OBI змінився; CVD від'ємний; викликав Order Flow Agent і отримав результат ...».
- `Risk escalation`: «Stop distance, volatility або account exposure вийшли за поріг; рекомендую перевірити ...».
- `News event`: «Офіційний announcement може вплинути на інструмент; джерело ...».
- `Thesis invalidated`: «Початкова теза втратила опору за критерієм X; пропоную сценарії ...».
- `Agent trace`: «Запущено Quant Agent / завершено / помилка / немає даних» (лише реальні виклики).
- `TP/SL/partial fill`: «Біржа підтвердила виконання часткового тейку; оновлені PnL та позиція».
- `Trade closed`: «Post-mortem готовий: чому відкрили, який був outcome, що підтверджено, які уроки потрапили до dataset».

### Додаткові можливості

1. **Trade Thesis Tracker** — відстежувати початкову ідею, критерії invalidation і drift.
2. **Scenario / Counterfactual Explorer** — що зміниться при переміщенні SL, 30% close, BE, частковому TP; окремо розраховувати risk/cost.
3. **Risk Guardian** — не лише ця угода, а й portfolio-level correlated exposure.
4. **Historical Analog Query** — схожі ринкові режими й результати з надійної історії.
5. **News Shock / Event Risk** — релевантні перевірені новини та announcement alerts.
6. **Regime Shift Detector** — тренд → флет/нестабільність, liquidity shock.
7. **Missed/Rejected Setup Analyzer** — аналізувати відхилені сигнали без hindsight bias.
8. **Execution Quality Agent** — slippage, spread, precision, fill latency, unexpected fees.
9. **Explain This Candle / Indicator** — користувач натискає свічку або індикатор та просить розбір із її даних as-of.
10. **Post-Trade Review** — prediction vs actual; learning pipeline status.
11. **Audit Timeline** — які рішення приймав AI, які факти це підтримували, хто авторизував дії.
12. **Quiet Mode / Summary Mode** — не спамити кожною секундною зміною ціни.

## P3.3. Механіка 24/7

**Не прив'язуй AI session до відкритої вкладки.** Worker/queue працює окремо від браузера. Browser лише підписаний UI-client.

```text
Bybit WS / Market Data / News / Trade Events
        ↓
Event Bus + Dedup + Snapshot Store
        ↓
Per-Trade Monitoring Scheduler
        ├── Fast deterministic detectors (volume, OI, structure, SL/TP state)
        ├── Risk policy checks
        └── Qualified AI analysis requests
                  ↓
         Lead Trade Agent / Tools
                  ↓
       Persistent Trade Timeline (Supabase)
                  ↓
           Realtime UI Chat + Notifications
```

- WS/ticker observation: streaming, з обробкою stale/disconnect.
- Quant features: по закриттю нової свічки, істотній події чи контрольному interval; не обов'язково LLM.
- AI reasoning: за матеріальною зміною ризиків/тези або за налаштовуваним summary schedule; **не** бездумний LLM call щосекунди.
- Рекомендовані продуктово налаштовувані режими: `Critical only`, `Event-driven` (default), `Detailed / 1-minute digest` (з aggregation), `Quiet`, `Paused`. Частоту можна змінювати без перезапуску Worker.
- Персистентність: після refresh вкладки чат відновлюється. Після закриття browser активна позиція продовжує моніторитися.
- По закритій угоді — read-only historical chat + post-mortem, без постійного poll.
- Обмеження: per-trade/tenant concurrency, rate limiting, budget per user, exponential backoff, token budget, dedup key, retry з idempotency, alert priority.
- Відображати `last analyzed`, `data as-of`, `worker heartbeat`, `ML model status`, `coverage`, `degraded/offline`.

## P3.4. Chat content provenance / database

Запропоновані сутності (точні назви й normalization після поточного schema audit):

- `trade_ai_sessions`: `id`, `trade_id`, `signal_id`, `account_id`, `user_id`, `status`, `model_policy_id`, `created_at`, `last_seen_at`.
- `trade_ai_messages`: `id`, `session_id`, `author_kind` (`user/lead/subagent/system`), `agent_id`, `kind` (`text/event/analysis/action_status`), `content`, `structured_payload`, `event_id`, `created_at`.
- `trade_market_snapshots`: as-of OHLCV/MFT metadata, features, microstructure, news IDs, checksum, quality, source timestamps (не обов'язково дублювати всі heavy дані в Supabase).
- `trade_ai_decisions`: `decision_type`, `recommendation`, `evidence_ids`, `snapshot_id`, `model_version`, `risk_policy_version`, `approval_state`, `action_id`, `execution_result`, `created_at`.
- `trade_ai_events`: persisted event stream із ідемпотентним `source_event_id`.

**Вимоги:** RLS `owns_account`/`user_id` isolation, paginated history, bounded payload size, sanitized tool outputs, immutable audit info, ретенція, індекси по trade/session/time, no cross-user leak. Розробляти міграції expand-first/backfill/contract. Реалізувати server-side authorization на кожний tool action.

## P3.5. Політика торгових дій AI

- Рівень 0: read/analyze/notify — дозволений після авторизації користувача й налаштувань.
- Рівень 1: recommend specific action, створити confirm UI — дозволений.
- Рівень 2: Paper-only autonomous simulation — окрема opt-in настройка з ризиковими лімітами.
- Рівень 3: Demo actions — окрема opt-in; не прирівнювати до Live.
- Рівень 4: Live action — **explicit per-action user confirmation by default**, server-side preflight risk check, cancel/rollback semantics, audit. Якщо коли-небудь додавати preauthorized Live automation, тільки за окремою явно погодженою специфікацією, суворими лімітами й протестованими захисними механізмами.
- Навіть якщо AI радить «вийти зараз», це **не** автоматичний market close; поки користувач не дав відповідний дозвіл, повідомлення має статус recommendation.
- Не дозволяти AI прибирати protective SL/TP чи обходити kill switch. Зміни risk controls — лише через deterministic gateway.

**P3 EXIT GATE:** chat реально живе в кожній trade session, пам'ятає події, отримує server-side updates без відкритого браузера, розрізняє реальні та припущені висновки, не може неконтрольовано виконати live trade.

---

# PHASE P4 — MULTI-AGENT RUNTIME, AGENTS, SKILLS, TOOLS

## P4.1. Оркестрація

Розробити власну систему, де **Vexqora Lead Trade Agent** може викликати спеціалізованих підлеглих агентів, ті — затверджені skills/tools і (за політикою) інших підлеглих агентів. Ціль — експертний аналіз, а не «багато паралельних LLM для вигляду».

```text
Lead Trade Agent (single user-facing context)
 ├─ Market Structure Agent → MTF trend/swing/BOS/CHOCH/FVG tools
 ├─ Order Flow Agent       → CVD/DOM/OBI/liquidity/large-trade tools
 ├─ Derivatives Agent      → Open interest/funding/liquidation tools
 ├─ Quant & ML Agent       → FeatureRegistry, model registry, EV & calibration
 ├─ News & Events Agent    → verified news feeds & event impact
 ├─ Historical Research    → similar-case retrieval, backtest-on-demand
 ├─ Risk Guardian Agent    → exposure, volatility, drawdown & preflight
 ├─ Execution Quality      → fill quality, slippage, spread, order state
 └─ Trade Learning Agent   → verified post-mortem & retrain dataset queue
               ↓
       Deterministic Execution Gateway
```

### Правила делегування

- `Lead Agent` бачить вихідні результати tools/agents у структурованому форматі, з `agentRunId`, `dataAsOf`, `quality`, `evidenceIds`, `errors`.
- Subagents не мають права самостійно торгувати або отримувати exchange secrets; вони видають аналіз і рекомендації.
- Максимальна глибина делегування, `maxInvocationsPerEvent`, token/time budgets, cancellation, dedup і cycle detection.
- Перевага дешевому deterministic tool, якщо це математична задача; LLM лише для синтезу, суперечностей, нетривіальних висновків.
- Реальні activity events в чаті: `requested`, `running`, `completed`, `failed`, `skipped`. Заборонені scripted fake agent progress messages.
- Підтримати model routing за складністю задачі та бюджетом, fallback із чесним degraded status.

## P4.2. Agent/Skill Registry у БД

Запропоновані сутності:

- `ai_agent_definitions`: `agent_key`, `version`, `display_name`, `purpose`, `model_policy`, `enabled`, `permissions`, `budget`, `parent_constraints`.
- `ai_skill_registry`: `skill_key`, `version`, `description`, `input_schema`, `output_schema`, `required_sources`, `required_bars`, `timeout`, `freshness_ttl`, `implementation_ref`, `test_suite`, `enabled`, `trust_level`.
- `ai_agent_skill_grants`: дозволи agent → skills із optional per-account rules.
- `ai_agent_runs`: sessions, event reasons, status, latency, token/cost metrics, modelVersion, createdAt.
- `ai_agent_tool_calls`: child run, tool name, validation, timestamps, summarized outputs, error info.
- `ai_agent_decision_evidence`: links to snapshots/news/source documents/outcome records.
- `ai_model_registry`: versions, training evidence, performance metrics, shadow/production state.

### Skill contract (приклад)

```json
{
  "skillKey": "market.mtf_structure",
  "version": "1.0.0",
  "input": {
    "symbol": "SOLUSDT",
    "exchange": "bybit",
    "timeframes": ["1D", "4H", "1H", "15M", "5M"],
    "asOfMs": 0
  },
  "output": {
    "status": "OK|INSUFFICIENT_DATA|STALE|ERROR",
    "regime": "trend|range|transition|unknown",
    "perTimeframe": [],
    "evidenceIds": [],
    "dataAsOfMs": 0
  }
}
```

Це **схема-контракт для розробки**, а не ринковий результат. Виклик tools реєструється, перевіряється через Zod/JSON Schema і має авторизовані джерела.

## P4.3. Додавання нових «навичок»

- Адмін/coding agent може запропонувати новий indicator/skill, написати реалізацію, тести, performance benchmarks і migration. Deploy тільки через code review/CI або аналогічний явно схвалений механізм.
- Runtime trading agent **не запускає довільний згенерований код**, не встановлює пакети, не читає сторонні secrets і не змінює trading policy самостійно.
- Наявні історичні дані в БД — джерело для перевіреного tool, а не привід дозволити SQL без RLS/audit.
- Version pinning: одна угода знає версію кожного використаного skill. Оновлення не змінює постфактум початкову торгову тезу.

## P4.4. Per-trade agent orchestration (приклад)

1. Open/attach trade session → verified snapshot.
2. Lead Agent записує initial thesis, invalidation levels, next review triggers.
3. Сильний bearish order flow на тлі LONG → Order Flow Agent перевіряє snapshot і якість CVD.
4. Market Structure Agent визначає, чи є реальний break (з відповідними ТФ).
5. Risk Guardian рахує об'єктивний сценарний ризик, fee/slippage й portfolio exposure.
6. Lead Agent порівнює суперечності, формує `HOLD / REVIEW / RECOMMEND_REDUCE / NO_ACTION`; `CLOSE` тільки як recommendation без дозволу виконання.
7. У чаті з'являється змістовний висновок + actual evidence/tool trace.
8. Якщо користувач підтверджує дію — backend execution gateway перевіряє все повторно на свіжих котируваннях та виконує за дозволом.

**P4 EXIT GATE:** multi-agent system має тести authorization, цикл/recursive call limit, cost, timeout, provenance, no secret leakage, predictable error handling і нуль самовільних live actions.

---

# PHASE P5 — VERIFIED CONTINUOUS LEARNING & TRADE RESEARCH

## P5.1. Не змішувати «пам'ять» та «навчання»

- `Memory`: зберегти market/signal/trade events, predictions, actual outcome, assistant messages і strategy versions.
- `Learning dataset`: нормалізовані, позначені, перевірені приклади; незалежні від текстових думок LLM.
- `Training`: плановий відтворюваний запуск з historical features/labels, quality checks та OOS metrics.
- `Deployment`: контрольований promotion/rollback нової модельної версії.

## P5.2. Як враховувати програшні позиції

- Для кожного loss зберігати **конкретну причину**, де дані дозволяють: wrong direction, poor entry timing, liquidity sweep, overextension, SL placement, excessive leverage, stale ticker, bad fill, high impact news, worker/race bug, false signal label, manual intervention.
- Не робити висновок «було 2 лузи — не купувати цю монету» без контексту і вибірки.
- Аналізувати rejected signals і no-trade cases, щоб виміряти false negatives/selection bias, а не лише win/loss по відкритих позиціях.
- Відокремлювати paper fill assumptions від live realized executions; до навчання додавати confidence in label.

## P5.3. Retraining gates

- Validation data quality + minimum genuine examples (пороги визначити за ефективним sample size та кожним regime, не вигадувати фіксовані гарантії).
- Chronological purged walk-forward, non-overlapping out-of-sample, calibration validation.
- Порівняння candidate/champion з однаковим transaction-cost model.
- Shadow deployment перед реальним впливом на рішення. При drift, missing features, regression — automatic rollback to previous validated version або no-trade degraded mode.
- Dashboards: sample count, coverage by symbol/timeframe/regime, model age, drift alerts, calibration, net EV, drawdown, confidence intervals, latency.
- Реалізувати periodic retraining як окреме scheduled job/worker, **не** від user page load чи одиночного лузу.

**P5 EXIT GATE:** можливо документально довести, яка версія ML вплинула на конкретний trade, на яких реальних даних її навчали та як вона пройшла незалежну перевірку.

---

# PHASE P6 — INFRASTRUCTURE, SECURITY, TESTING, RELEASE

## P6.1. Розміщення компонентів

| Component | Recommended responsibility | Requirements |
|---|---|---|
| Next.js/Vercel | UI, server actions, авторизація, read APIs | Не запускати фоновий 24/7 inference як browser state |
| Supabase/PostgreSQL | Auth, ledger, trade state, signal memory, agent registry, event metadata | RLS, indexes, atomic RPC, migrations, audit |
| Long-lived Worker | Execution & protective processing, market watchers, event bus scheduler | HA/restart, concurrency lock, health, retries |
| Market Data Store | Historical tick/trade/ohlcv/derivatives snapshots | Coverage, source provenance, compression, retention |
| Python ML Training | Feature generation, model experiments & calibration | Може працювати на домашньому ПК; відтворюваність |
| ML Inference service | Live scoring із validated model | Стабільний endpoint із auth/health, independent from local PC |
| LLM service | Nemotron/approved models, Lead/subagent reasoning | Budgets, routing, provenance, no execution secrets |

Домашній ПК/SSD можна використати для великої історії та навчання. **Не** робити його єдиним компонентом, який тримає захист відкритих ордерів. Якщо домашній інтернет/електрика пропали — exchange-side SL/TP, критичний Worker та user alerts повинні працювати окремо.

## P6.2. Обов'язкові QA-сценарії

### Data / indicators / ML

- RSI length/value correctness; multi-timeframe align; candle closed status; timezone; data gaps.
- Real vs fixture/synthetic distinction; model unavailable; timeout; stale source; wrong feature schema; unknown market.
- Train on real market data; impossible to accidentally deploy synthetic-only; model metadata/registry; walk-forward reproducibility.
- Calibration tests; no lookahead; intrabar ambiguous fills; funding/fees/latency.

### Trading execution / data integrity

- Paper/Demo/Live boundary; RLS ownership; invalid tick/qty; fees; trailing & partial TP; stop first, race & duplicate fill.
- User page refresh does not change position/balance; replayed event idempotent; worker restarts; WebSocket outage.
- Risk gateway cannot be bypassed via chat, server action, API request або підлеглий агент.

### AI-chat/agents

- Separate session per `trade_id+account_id`; archived replay; two tabs; reconnect/offline recovery.
- User message and event-driven notifications ordering/dedup; no fabricated tool calls.
- Subagent latency/timeout/retries/budgets/depth; cross-tenant data isolation; secret redaction.
- Explicit confirmation before any live action; action status shows confirmed exchange ack/fill, not LLM text.

### UI regression

- Screenshot comparisons на wide desktop, ноутбук, tablet, mobile.
- All old controls accessible; controls behave unchanged; keyboard and touch tests.
- Chat subscription не створює нескінченний ререндер великого chart.

## P6.3. Observability & operations

- Structured logs: correlation IDs `signalId/tradeId/sessionId/agentRunId/eventId`, no API secrets and no personal identifiers in plain tool traces.
- Metrics: market coverage, data freshness, stale symbols, ML true-inference %, fallback %, model drift, LLM success/latency/cost, worker heartbeat, event backlog, order idempotency, trade settlement mismatches.
- Admin dashboard для загального стану: `Data Sources / Models / Agents / Worker / News / Signals / Execution`.
- Feature flags/rollout: `verified_ml`, `mtf_intelligence`, `news_intelligence`, `trade_companion`, `multi_agent`, `paper_ai_actions`. Увімкнення поступове, default без автономних live actions.
- Міграції expand-first і rollback/backup plan; не ламати старі клієнти або історію.

---

# 7. ПЛАН ПОСТАВКИ: ЩО ТИ МАЄШ ЗРОБИТИ ЗАРАЗ

Не виконувати P0–P6 одразу одним PR. Рекомендовані deliveries:

| Delivery | Склад | Приймання |
|---|---|---|
| **D0 — P0 Audit & Fixes** | RSI, contracts, ML provenance, data integrity repair, synthetic fallback, gate enforcement | Tests + migration review + no regression |
| **D1 — P1 Data & ML** | MTF snapshots, indicators, market/structure scanner, microstructure integrity, news ingestion, real training | Coverage report + real ML/OOS evidence |
| **D2 — P2 Terminal UI** | Full-width layout, all preserved controls, responsive panels | UX screenshots + behavior parity |
| **D3 — P3 AI Companion** | Per-trade chat sessions, events, background scheduler, transcript, notifications, approvals | End-to-end AI chat demo on Paper |
| **D4 — P4 Agent Runtime** | Lead/subagents, skills registry, permissions, real tool traces | Security/budget/delegation tests |
| **D5 — P5 Continuous Learning** | Outcomes→datasets→training→shadow→promotion | Reproducible OOS+calibration results |

Порядок D2/D3 можна частково паралелити після стабілізації P0, але data provenance/permissions — перед автономними рекомендаціями/діями.

## 7.1. Для кожної доставки підготувати

1. **Audit findings:** що було, що підтверджено, що не вдалося перевірити, конкретні `file:line` та відтворення.
2. **Change map:** які файли створюються/змінюються; schema/migrations; навіщо це потрібно; яку поведінку зберігаємо.
3. **Tests:** точні команди та результат (із реального запуску, не вигадані).
4. **Risk analysis:** production/ledger/live order impact, downtime, fallback & rollback.
5. **Screenshots/recordings** для UI змін desktop/mobile.
6. **Feature flags + deployment guide:** secrets/env, Worker changes, data migrations, release strategy.
7. **Honest status table:** `Implemented in code`, `Tested`, `Deployed`, `Operational`, `Not verified` — не змішувати статуси.
8. **Next PR plan** за результатами поточного етапу.

## 7.2. Acceptance definition of done (для всієї програми)

- **Не втрачено** жодного старого критичного execution чи portfolio feature.
- User бачить реальний статус даних/ML/agents, немає вигаданих свічок, статистики або самовпевненого fake reasoning.
- Система знаходить не лише раптові pump/dump, а й liquid moderate structural opportunities з MTF evidence.
- News & external event coverage має конкретні джерела, timestamps та обмеження; відсутність джерела — явно видима.
- ML використовує справжню верифіковану модель і пов'язану тренувальну історію або чесно оголошує unavailable/fallback.
- Повноцінний full-width terminal має chart + trading controls + always-on AI Trade Companion, на desktop та mobile.
- Lead agent делегує реальні задачі спеціалістам/tools; кожний висновок містить evidence і статус виконання; delegation bounded.
- Вся автоматизація live trades відділена від розмовного AI та захищена explicit authorization, risk & execution gateway.
- Continuous learning працює як **контрольований, перевірений pipeline**, а не зміна heuristic score після двох лузів.

---

# 8. ЧОГО НЕ РОБИТИ

- Не оголошувати «ідеальну стратегію», «AI завжди розуміє ринок», «70% confidence = 70% реалізованого win rate» без калібрування й достатньої вибірки.
- Не переписувати весь Vexqora у Freqtrade/Qlib/NautilusTrader: за потреби адаптувати окремі ідеї, дані чи інструменти; залишити власні UI/API/Execution contracts.
- Не відмовлятися від Smart Money: залишити SMC як **одне** джерело доказів серед order flow, statistics, derivatives, news, risk та ML.
- Не генерувати новини, кейси, трейди, історичні win rates або candles «для красивого UI» у production.
- Не дозволяти LLM переписувати indicator calculation або SQL-схеми без CI/code review.
- Не створювати публічний сервіс на домашньому ПК, що відкриває Supabase service-role / біржові ключі, без окремого security design.
- Не спамити user кожної секунди AI-повідомленнями або викликати 8 дорогих моделей щохвилини на всі позиції.
- Не плутати баг із ціною/settlement із поганим торговим рішенням під час ML learning.
- Не прибирати SL/TP і не вимикати ризикові захисти, коли AI «впевнений».

---

# 9. ПЕРШЕ ПОВІДОМЛЕННЯ, ЯКЕ ТИ МАЄШ ВИДАТИ РОЗРОБНИКУ ПІСЛЯ ПРОЧИТАННЯ

Після прочитання цього файлу **почни з D0/P0**, а не з нової красивої сторінки. Спочатку зроби актуальну верифікацію коду, знайди й відтвори RSI bug, перевір таймстампи, localhost ML bridge, synthetic fallbacks, UI Ensemble defaults та hardcoded repairs у server render. Покажи короткий audit table із `confirmed / fixed / already fixed / not verified`. Потім створи невеликий PR з тестами й чітким recovery plan.

**Не потрібна зайва дискусія про вибір архітектури, якщо її можна підтвердити кодом і тестами. При цьому не роби ризикованих production/live дій без дозволу власника Vexqora.**

---

**Кінцева концепція:** Vexqora — не просто генератор LONG/SHORT. Це доказова, event-driven, multi-timeframe trading intelligence platform із контрольованими ML-моделями, надійним execution/risk шаром, повноекранним торговим терміналом та персональним AI Companion для кожної угоди. Система повинна вміти відповідати **«НЕ ТОРГУВАТИ / НЕДОСТАТНЬО ДАНИХ»**, якщо факти не підтримують вхід.
