# VEXQORA AGENTIC TRADER 2.0 — НЕПРИЙНЯТНІ КОМПРОМІСИ / IMPLEMENTATION CONTRACT

> **ПРІОРИТЕТ: BLOCKING / STOP-SHIP.** Це НЕ концепт, НЕ перелік побажань і НЕ прохання додати кілька AI-віджетів. Це обов'язкове технічне завдання на заміну псевдо-інтелектуальної архітектури Vexqora справжнім **інструментальним AI-аналітиком ринку**, який працює незалежно від браузера. Документ адресовано AI-розробнику (Codex / Claude / Antigravity). **Не заявляй «усе зроблено», доки не виконані перевірювані acceptance-критерії.**
>
> **Аудит-джерело:** GitHub `s1zeNof/Vexqora`, перевірена база `main@7f37dde86c2bd7f64cd64e10b1c684c4a7dbcf72` (28.10.2026). Перед роботою ОБОВ'ЯЗКОВО перевір актуальний HEAD і вже виконані зміни. **Факт реалізації в репозиторії не дорівнює факту production-розгортання.** У додатку А наведено точний незалежний аудит і шляхи проблемних файлів.

## 0. НАКАЗ: ЩО Є УСПІХОМ І ЩО НЕ Є УСПІХОМ

**НЕПРИЙНЯТНО:** Vexqora знаходить «аномалію» фіксованими порогами, з одних і тих самих 25 свічок обчислює кілька індикаторів, генерує стандартні рівні SL/TP, підставляє наперед задані `winProbabilityPct`, викликає OpenRouter лише для красивого абзацу і називає це професійним Multi-Agent AI.

**ОБОВ'ЯЗКОВО:** система має відстежувати режим усього ринку, незалежно знаходити придатні активи, автоматично переглядати кандидати і вже відкриті угоди при зміні BTC, новин, структури та ліквідності; **Lead AI має сам обирати, які інструменти й субагенти викликати, запитувати додаткові дані, перевіряти суперечності, формувати торгову гіпотезу та її умови інвалідації**. Усі висновки — з перевіреними джерелами, таймфреймами, часом даних і реальними tool traces.

**ВАЖЛИВО:** «AI керує дослідженням» НЕ означає «LLM рахує RSI в тексті», «LLM вигадує win-rate», «LLM самовільно розміщує біржовий ордер». Арифметика, часові ряди, ризик-правила, біржові точності й execution — тільки перевірений код. AI — планування, інтерпретація, поглиблення аналізу та рішення, які може незалежно відхилити Risk Engine.

### 0.1 ЖОРСТКІ ЗАБОРОНИ — НЕ ОБГОВОРЮЮТЬСЯ

1. **ЗАБОРОНЕНО** заміняти відсутню реальну ринкову ціну, candles, high/low, funding, volume, OI, Order Flow або новини фіктивними значеннями. Немає даних — `UNAVAILABLE/STALE`, без сигналу.
2. **ЗАБОРОНЕНО** задавати `winProbability=74/69/64/72`, «AI confidence», вигадані samples/історичні win rates, фальшивий `R:R=2.2`, використовувати неемпіричний backtest як доказ прибутковості. Без каліброваної OOS-моделі поле ймовірності — `null`, а не гарне число.
3. **ЗАБОРОНЕНО** генерувати live-ready сигнал із `generateOpportunityFromTicker()` при помилці LLM/ML/News/критичних ринкових даних; fallback — явний `NO_TRADE / INSUFFICIENT_DATA`, а не «добудувати сетап за шаблоном».
4. **ЗАБОРОНЕНО** видавати `PASS` для гейтів, дані яких не перевірено. Відсутність критичного доказу = `UNKNOWN` з блокуванням відповідно до серверної policy. Не робити «чотири зелені галочки», якщо перевірено один R:R.
5. **ЗАБОРОНЕНО** називати шаблонний ланцюжок `structure -> orderflow -> risk -> news` автономним tool-using агентом. Обов'язковий реальний LLM tool/function-calling loop з інструментальними результатами й динамічним вибором.
6. **ЗАБОРОНЕНО** створювати SSE-статуси «Агент перевіряє BTC/китів/новини», якщо фактично не було відповідного tool call або джерело `UNAVAILABLE`.
7. **ЗАБОРОНЕНО** обробляти лише три випадкові імпульсні монети за цикл і називати це повним AI-моніторингом ринку. Потрібен coverage/fairness/latency report всесвіту монет; пріоритет активних угод — вище discovery.
8. **ЗАБОРОНЕНО** робити висновок «новин немає» з порожнього запиту. `news coverage UNAVAILABLE` ≠ `NO_NEWS`.
9. **ЗАБОРОНЕНО** виконувати live-ордери, змінювати реальні SL/TP, плече, часткові закриття чи equity без наявної explicit user policy + незалежного risk/permission gate. У тестах — жодних живих ордерів.
10. **ЗАБОРОНЕНО** мовчки змінювати схему Supabase, запускати `COMPLETE_ALL_IN_ONE_SETUP.sql`, стирати дані або підміняти Senzo-базу базою Vexqora. Тільки міграції вперед, контрольована перевірка та rollback.
11. **ЗАБОРОНЕНО** вважати `typecheck/lint/test/build` достатнім підтвердженням готовності. Потрібні робочі інтеграційні докази для кожного acceptance-сценарію, наведеного нижче.
12. **ЗАБОРОНЕНО** позначати пункт «DONE», якщо він частковий, не розгорнутий, не має тестів або залежить від недоступного зовнішнього сервісу. Вказуй `IMPLEMENTED_NOT_DEPLOYED`, `BLOCKED`, `PARTIAL`, `NOT_STARTED` або `VERIFIED_PRODUCTION`.
13. **ЗАБОРОНЕНО** змушувати LLM наперед підтверджувати обраний алгоритмом «найкращий» сценарій. Модель повинна мати законну можливість повернути `WAIT`, `NO_TRADE`, новий дослідницький крок або суперечність із початковою гіпотезою.
14. **ЗАБОРОНЕНО** приписувати виконанню торгових ордерів гарантію беззбитковості — враховувати fees, slippage, funding, gap/liquidation, exchange-side order state.

## 1. STOP-SHIP: ПЕРШІ РОБОТИ, ЯКІ НЕ МОЖНА ОБІЙТИ

Це обов'язковий порядок. Якщо P0 не виконано, **не демонструй «успішну автономну торгову систему» і не запускай Live**. Паралельно допускаються незалежні гілки, але релізний gate P0 залишається blocking.

| ID | Дефект, підтверджений у базовому HEAD | ОБОВ'ЯЗКОВИЙ результат | Що є доказом |
|---|---|---|---|
| P0-01 | `copilot-analyst.ts` створює SL/TP за статичними % і `74/64/69` win-rate | Забрати ці значення із production decision path; цілі — з перевіреної структури/ATR/ліквідності, ймовірність без OOS = null | Тести на 10 різних режимів; немає фіксованих цілей для однакової ціни з різними OHLCV |
| P0-02 | `copilot-analyst.ts` повертає фейкові BTC 67500 / ETH 2600 / SOL 175 / high-low ±3% | Єдиний `MarketDataResult` з `status/source/asOf`; unknown => no candidate, no hallucination | API offline + unknown symbol => немає ціни/сигналу |
| P0-03 | `nemotron.ts`: `rr >= 1 ? rr : 2.2` | R/R визначається тільки перевіреними реальними рівнями; RR нижче політики = reject | Test з RR 0.8 повертає 0.8 і reject, а не 2.2 |
| P0-04 | `ai-copilot.ts` ловить sweep на вікні включно з останнім баром, при `<3` bars synthetic ATR і `sweptLiquidity:true` | Fixed closed-candle lookback excludes candle being tested, insufficient data => `UNKNOWN` | Property-based OHLCV tests, wick-only and closed-bar test |
| P0-05 | `ai-learning.ts`, `memory.ts` — фіксовані штрафи, неемпіричні нібито результати минулих угод | Жодних емпіричних claims без raw dataset; чіткий separation `heuristic` vs `trained/calibrated` | JSON provenance contract + відсутність fake performance у відповіді LLM |
| P0-06 | `ensemble-gate.ts`: optional `evUsd`, `mlDecision`, news, structure => fail-open | Реальний серверний `GateEvidence` із PASS/REJECTED/UNKNOWN; policy enforces mandatory fields | Simulated missing ML/critical news + всі шляхи order execution перевірені на блокування |
| P0-07 | `pulse-scanner.ts` deep-scans тільки impulse top3, `pulse.ts` — thresholds лише 5–60s | Fair discovery scheduler + регулярний structural scan без локального імпульсу + BTC-trigger | BTC shock при незмінному ALT => ALT reassessed; >3 candidate coverage metrics |
| P0-08 | `agent-runtime.ts` — 4 фіксовані subagents, static verdict, LLM не обирає tools | Tool-call loop: plan → call → observe → evaluate gaps → replan → verdict | Реальні traces, різні набори інструментів для різних задач; no fictional progress |
| P0-09 | `news.ts` — parser/classifier, фактично немає live feed | Verified news ingestion + exchange updates + macro calendar; source/time/impact | News shock fixture -> changed thesis; offline -> UNKNOWN |
| P0-10 | BTC/ETH як контекст не є частиною signal/agent decision input | Global Market Regime з BTC/ETH + relative alt beta/correlation/breadth | BTC regime flip triggers all affected thesis reevaluation |
| P0-11 | `ml-bridge.ts` може не мати доступу до сервісу, `.cbm` не підтверджено | ML artifact registry, live availability, data provenance, calibrated OOS або `MODEL_UNAVAILABLE` | model health with concrete version+weights; fallback cannot imply learned win-rate |
| P0-12 | торгова risk/signal logic розходиться між Copilot, Pulse, Trade chat і scan | Один канонічний Research/Thesis/Validate pipeline для всіх інтерфейсів | Same market snapshot -> same verdict independent of entry point |

**Примітка щодо P0-06:** суворість `UNKNOWN` має відповідати типу операції й явно погодженій торговій політиці. Не блокуй необхідні захисні дії (зниження ризику, закриття ризикової позиції, аварійний stop) через відсутню LLM; але новий ризиковий вхід за відсутніх обов'язкових даних має бути заблокований. Зафіксуй цю відмінність тестами.

## 2. ПЕРЕБУДУВАТИ КОНТУР — НЕ «ДОКРУТИТИ» ЧОТИРИ АГЕНТИ

### 2.1 ЄДИНА АРХІТЕКТУРА, ВИЗНАЧЕНІ МЕЖІ ВІДПОВІДАЛЬНОСТІ

```
[Exchanges REST/WS] [Verified News+Macro] [History/Data Lake]
          \              |                  /
       Normalization + Validity + Time Alignment + Provenance
                              |
                     GLOBAL MARKET STATE
    (BTC/ETH regime, breadth, correlations, risk-on/off, venue)
                              |
                 Event Bus + Scheduled Discovery
        (BTC shock, HTF shift, news, liquidity, time, alerts)
                              |
                    LEAD TRADER AGENT
         [plan] -> [read tools] -> [evaluate evidence]
            ^             |                |
            |        [specialists]         v
            +-- [replan / resolve conflicts] --+
                              |
                  Trade Thesis / Verdict
     LONG | SHORT | WAIT | NO_TRADE | REASSESS | EXIT_REVIEW
                              |
                 VALIDATOR / RISK GATEWAY
                  [reject / paper / approval]
                              |
        Persistence + Notifications + Observability + Replay
```

**Забезпечити один канонічний backend research service**. `Copilot`, `Pulse`, `Signals`, `Trade Companion` мусять бути клієнтами того самого сервісу, а не чотирма копіями власних `if/else`. Підтримати одночасно chat-driven research, scheduled discovery, reassessment existing thesis, post-trade research.

**Не приписуй LLM «власні знання трейдера» одним system prompt.** Знання повинні бути в доступному каталозі концептів, перевірених tools і реальних ринкових джерел. System prompt — правила мислення, а не підміна даних.

### 2.2 ЗРОБИТИ РЕАЛЬНИЙ LLM TOOL LOOP, А НЕ ОДИН `callNemotron()`

`callNemotron` зараз приймає повідомлення та опції, але не `tools` і не обробляє `tool_calls`. Перероби provider layer із tool/function-calling, tool schema validation, streaming run events, fallback model capability discovery. Явно обробляй випадок, коли обрана OpenRouter-модель не підтримує tool calling. `deepseek/deepseek-chat` чи модель з назвою Nemotron не є гарантією підтримки конкретного API.

**Обов'язкова поведінка виконання:**

1. Отримати ціль і market snapshot ID; запланувати необхідні дослідження (без передвизначеного списку всіх 4 агентів).
2. Викликати read-only інструменти реальними API/function calls; передавати аргументи лише після Zod/JSON Schema validation та authorisation.
3. Записати для кожного виклику `toolCallId, agentRunId, toolName, argsHash, startedAt, finishedAt, dataAsOf, source, quality, status, resultRef`.
4. Прочитати результати, знайти конфлікти: BTC bullish vs alt CVD negative; HTF bullish vs LTF sell sweep; новости vs техніка; несталі дані.
5. Якщо потрібна додаткова перевірка — **LLM має викликати ще один tool**, а не просто сказати «варто перевірити»; якщо ліміт вичерпано, повернути чесний `INSUFFICIENT_EVIDENCE`.
6. Сформувати структуровану hypothesis з supporting/contradicting evidence, action state, invalidation conditions, expiry, uncertainties.
7. Незалежний валідатор перевіряє структуру, stop, TP, RR, tickSize, commissions, exposure, account permissions, data age і тільки потім виставляє `APPROVED_FOR_PAPER` або `REQUIRES_CONFIRMATION` за policy.

**Бюджетні й безпекові ліміти:** max 2–3 cycles of replanning, max 8–15 external calls per run, timeouts, per-user token limits, deduplication/cache, cancellation, circuit breaker, no arbitrary code execution, no secret exposure, no direct SQL from model. Межі можуть налаштовуватися, але мають бути серверними та протестованими.

**Мінімальні спеціалізовані ролі:** Global Regime/BTC, Market Structure, Quant/Indicators, Order Flow+Whales, Derivatives/OI/Funding, News+Macro, Historical Research/ML, Risk & Portfolio. Реальна розбивка на агентів допускає оптимізацію, але жодну з цих інформаційних функцій не можна тихо «відрізати». Risk & Portfolio — незалежний deterministic enforcement, AI може лише отримувати його висновок та запитувати read-only розрахунок.

### 2.3 КОНТРАКТ КАТАЛОГУ TOOLs — НЕ ФЕЙКОВІ ФУНКЦІЇ

**Реалізувати й протестувати read-only API:**

| Tool | Обов'язкові дані / гарантії |
|---|---|
| `get_global_market_regime` | BTC/ETH 1D/4H/1H/15M; returns status+asOf and regime plus breadth |
| `get_btc_dependency` | rolling correlation/beta/relative performance 5m/1h/4h/1d (лише за достатньої статистичної вибірки) |
| `list_indicators` | machine-readable catalog, supported parameters, required bars, timeframe and versions |
| `compute_indicator` | EMA/SMA, RSI, ATR, MACD, Bollinger, VWAP/anchored VWAP, ADX, Ichimoku, OBV, MFI, StochRSI, Volume Profile/POC/VAH/VAL там, де є достатні дані; pure validated math |
| `get_market_structure` | confirmed swings, valid BOS/CHOCH, trend, FVG, OB із параметрами та доказовими рівнями |
| `get_orderflow` | L2 vs executed-tape delta, trade window, CVD period, bid/ask depth, spread, staleness |
| `get_whale_activity` | observed large prints, sweeps, OI/liquidation evidence, no guessed hidden iceberg |
| `get_derivatives_context` | funding, open interest delta, liquidations if provider supports; venue+timestamp |
| `search_verified_news` | source URL, published/ingested times, dedupe, relevance, claim verification |
| `get_economic_calendar` | release time/timezone, scheduled/actual/forecast/previous, freshness and provider |
| `get_historical_analogues` | only empirical events from data lake with sample count and regime match; no scripted 27/37 claims |
| `get_ml_prediction` | modelId/version/calibrated?, OOS metrics, coverage status, probability iff calibrated |
| `get_portfolio_risk` | verified equity, exposure, max loss, leverage, kill switch, active exchange protections |
| `simulate_trade_scenarios` | real volatility & levels, fees/funding/slippage, actual RR, no hardcoded TP1=3.2% |
| `get_trade_thesis` / `save_trade_thesis` | versioned thesis, evidence delta, invalidation and last reassessment (write only via authorized backend workflow) |

У кожного tool response обов'язкова спільна оболонка `status: OK|STALE|UNAVAILABLE|ERROR`, `exchange`, `marketType`, `symbol`, `timeframe`, `source`, `asOfMs`, `receivedAtMs`, `candlesUsed`, `qualityWarnings`, `data` або `error`. Відсутні числа — **null, не 0**. За надто малим warm-up — `INSUFFICIENT_DATA`, жодного розрахунку EMA200 з 25 свічок. Sources tracked from Bybit/Binance, no silent mixing.

**Вимога «доступ до будь-якого індикатора» означає доступ до відкритого, розширюваного каталогу індикаторів із capability discovery; не вигадуй індикатор, якого ще немає в реєстрі.** Якщо запитується непідтримуваний — агент чітко називає обмеження і може запропонувати реалізацію в окремому релізі.

## 3. BTC І ГЛОБАЛЬНИЙ РИНОК: НЕ МОЖНА ДАЛІ ІГНОРУВАТИ

**Зараз BTC рухається — система повинна реагувати на ЗМІНУ РЕЖИМУ, а не чекати, поки кожен альткоїн окремо зробить локальний імпульс 0.70%.**

- Global Market Monitor постійно розраховує й версіонує `MarketRegimeSnapshot` BTC/ETH, ринкову ширину, alt relative strength, volatility, funding/OI, sector rotation та виміряну кореляцію BTC–ALT.
- **Event source:** `BTC_REGIME_CHANGE`, `BTC_IMPULSE`, `ALT_BTC_DECOUPLING`, `NEWS_SHOCK`, `HTF_STRUCTURE_CHANGE`, `VOLUME_OI_ANOMALY`, `SIGNAL_STALE`, `TRADE_RISK_CHANGE`, `SCHEDULED_RESCAN`.
- Якщо BTC змінив режим, **перерахувати всі релевантні preview/pending сигнали й відкриті угоди**, навіть якщо локальна ціна альта ще не відреагувала. До переоцінки прострочений trade thesis не має виглядати валідним. Масові перевірки через queue, concurrency cap, tiered priorities, dedupe.
- Виявляти винятки: альткоїн може бути сильнішим/слабшим за BTC або некорельованим. На XAUUSDT важливі XAU/USD, DXY, доходності US10Y і макро-календар; не перетворюй BTC на універсальне правило.
- Discovery має сканувати не лише «помірні 24h зміни» чи локальні pump signals, а й trend continuation, retracement into valid zones, reversal setup, volume divergence та watchlist opportunities. Кожен candidate має конкретну причину evaluation і measurable coverage.
- **Не створювати «сигнал» заради частоти.** Відсутність edge = `NO_TRADE` із чіткими причинами й умовами для повторної перевірки.

**Acceptance BTC:** у контрольованій симуляції `BTC 4H bullish→bearish`, при незмінному ALT ticker, активуються події перегляду відповідних альтів, заново викликаються необхідні tools, зберігається `thesis_revision_id`, в UI з'являється змістовне обґрунтування з timestamp. Без цієї демонстрації пункт НЕ виконаний.

## 4. NEWS INTELLIGENCE — НЕ `events=[]`

Побудуй справжній ingestion із відкритих/ліцензованих джерел: оголошення біржі, підтримуваний news provider із URL, економічний календар CPI/FOMC/NFP, регуляторні й мережеві події. Система повинна вміти:

- зібрати подію, перевірити джерело й дату, відокремити `publishedAt` від `receivedAt`, обробити таймзону;
- дедуплювати репости, зберегти source URL і provenance, виділити affected assets / all market / sector;
- визначити фактичний або очікуваний market impact із доказами, а не лише пошуком слова `CPI` у заголовку;
- ініціювати перегляд релевантних trade theses і сигналів з урахуванням того, чи подія вже була «в ціні»;
- показувати explicit `NEWS_UNAVAILABLE` при збою джерела, а не «новини спокійні»;
- дозволити AI за потреби зробити повторний news search, перевірити кілька джерел і відзначити суперечність.

**Acceptance news:** для BTC/ALT/XAU є fixtures щонайменше high-impact macro event, delisting/technical incident, false/duplicate rumor і offline provider. Залежно від змісту система або переоцінює thesis, або обґрунтовано не змінює її, з audit trail; не генерує фальшивих «немає ризиків».

## 5. АВТОНОМНІСТЬ: AI ВЕДЕ ЗА РУКУ, А НЕ ПЕРЕПОВІДАЄ UI

**Trade Companion = stateful research agent із пам'яттю гіпотези**, а не чат, який при питанні друкує Entry/SL/TP.

- При появі сигналу: сам перевіряє global regime, symbol MTF, Order Flow, News, funding/OI, optional historical analogues і формує research note. Не обов'язково запускати всі tools — план має бути релевантним.
- При вході: зберігає початковий thesis, підтвердження, причини інвалідації, ризики, source snapshots, last agent run і наступні recheck triggers.
- **У фоні без браузера:** Worker слухає події; важлива зміна → ResearchRun → новий або незмінений verdict із доказами → повідомлення лише коли є корисна зміна. НЕ генерувати дорогий LLM prompt для кожного тіку.
- При відповіді показати не банальну «ціну», а **«Що змінилося? Чому? Які докази за/проти? Що я перевірив додатково? Коли теза втратить силу? Яка наступна запланована перевірка?»**
- При зникненні джерела даних: позначити висновок `UNKNOWN`; не стверджувати, що «кити купують», якщо є лише L2 snapshot.
- При закритті: post-trade attribution — фактичний PnL, fees, risk deviation, outcome / mistakes, без вигаданого «модель навчилася»; learning dataset + майбутній незалежний retrain pipeline.
- Реальні tool-calling events у чаті: агент *справді* викликав `get_btc_dependency` чи `compute_indicator` → UI показує `completed`, timing та source. Не підміняти фальшивими етапами, згенерованими до виклику інструментів.
- SQL/session isolation, retry, idempotency, 120+ messages pagination, 51+ active sessions fairness, worker heartbeat, process restart tests, no duplicate AI responses.

**Приклад обов'язкової поведінки:**

```
TRIGGER: BTC 1H breakout; SOL LONG trade exists.
1) Agent Run: get_global_market_regime(BTC), get_btc_dependency(SOL),
   get_market_structure(SOL,4H/1H/15M), get_orderflow(SOL),
   [if conflict] compute_indicator(SOL,ADX), get_derivatives_context(SOL).
2) AI порівнює нові докази з thesis, який сам раніше зберіг.
3) Висновок: «BTC імпульс підтверджено, але SOL відстає від BTC,
   а aggressive sell tape переважає. Гіпотеза LONG ПОСЛАБЛЕНА,
   інвалідація при підтвердженому закритті нижче структурного рівня X.
   Перевірив A,B,C; дані news: UNAVAILABLE. Автоматичних live дій не виконую».
4) Persist evidence + send one non-duplicated meaningful notification.
```

Це лише приклад **поведінки й формату**; текст, стан та рівні не повинні бути hardcoded.

## 6. РЕАЛЬНИЙ ML І ПОКАЗНИК «ЯКОСТІ» — ТІЛЬКИ З ДОКАЗАМИ

- Для кожної заяви про `win probability` вимагати **trained model ID, artifact hash/version, real dataset, symbol/regime applicability, out-of-sample period, calibration curve/Brier score, sufficient sample count**, fees/funding/slippage/latency policy.
- CatBoost-код у repo ≠ model loaded in production. Python `/health` з `status=online` ≠ `predict` має навчений `.cbm`. Верифікуй model loaded + training metadata + actual inference path. Якщо ні — `MODEL_UNAVAILABLE` і відповідний policy verdict.
- Збери статистику реальних paper/simulated угод та чистий data lake; не вигадуй історію «37 угод, 73%» для майбутньої моделі. Реальні backtest та walk-forward із leakage prevention, purged splits, held-out periods і контроль fee/slippage; жодних «покращили точність до 90%» без даних.
- Кожен агентний кандидат порівнювати з rule-only baseline у **shadow mode**, а не за враженням від гарного пояснення. Відстежувати expectancy after costs, PF, drawdown, hit rate, average win/loss, calibration, trade count, regime performance, no-trade rate.
- **50/50 результат не виправляється просто новою LLM.** Успіх — фактично доведена позитивна очікувана цінність після витрат на значущій незнайомій вибірці. Без цього не стверджувати «професійний прибутковий AI».

## 7. RISK, EXECUTION, DB — ЦЕ ОКРЕМИЙ НЕЗАЛЕЖНИЙ КОНТУР

1. Увесь analysis tool access тільки read-only. Ніякого direct order-placement tool для LLM. `OrderProposal` проходить окрему авторизацію та `RiskGateway` поза prompt, поза моделлю, із власними перевірками account/risk/freshness/permissions.
2. За замовчуванням Paper/Shadow. Demo/Live лише після явної авторизованої політики й окремого запуску користувачем; без автономних live входів від AI. Emergency close/risk-reducing actions мають не залежати від доступності LLM.
3. Не дозволяти змішувати біржовий акаунт зі статусом Paper у Live. Перевірити margin type, minimum qty/notional, tickSize, leverage, real SL/TP state й можливість коректного close/reduce-only.
4. При кожному вході (`submitEntry`/`runner`/dashboard/копілот) застосовувати єдиний server gateway та edge-case tests. If missing `ML`/`news`, policy explicitly determines `UNKNOWN`, NEVER fake `PASS`.
5. Supabase: не запускати міграції автоматично. Перевірити фактичну схему Vexqora, зокрема згаданий раніше drift `trades.tp1` vs `trade_targets`, RLS для двох користувачів, dedup `client_message_id`, session ownership, worker service role, backup і rollback. Тільки нові incremental migrations і script із dry-run inspection.
6. Жодних непрямих мутацій під час GET/render; жодних тестових live ордерів; жодних несанкціонованих змін існуючих балансів або угод.

## 8. ОБОВ'ЯЗКОВИЙ ПЛАН РОБОТИ: НЕ ПЕРЕСТРИБУВАТИ ФАЗИ

### Gate A — Baseline і зафіксовані P0

Прочитати поточний `main`, `AGENTS.md`, README, `docs/ARCHITECTURE.md`, усі міграції; зафіксувати status для кожного ID з таблиці P0. Повторити ключові баги тестами **до виправлення**. Внести P0 fix маленькими комітами, red/green tests, без змін дизайну. **Пропуск будь-якого P0 — незавершена фаза.**

### Gate B — Дані і Tools

Реальні BTC/market regime, новини й macro, OHLCV multi-TF, orderflow, indicator registry, provenance. Tool API повинні бути викликані й відповісти **реальним типізованим результатом** — демо заглушки не приймаються. Test offline/stale/status handling.

### Gate C — AI Agent Orchestration

Tool/function calling працює із моделлю, яка підтримує його, надійні retries/fallback, реальні записи agent runs. Порівняти незалежні користувацькі запити й події, довести різний вибір інструментів; AI використовує факти. Структурований JSON decision валідований. Один research engine для всіх каналів.

### Gate D — Worker/Trade Thesis

Production-спостережуваність, BTC/news events, активні угоди й preview signals, зберігання стану навіть без браузера, pagination, concurrency/quotas/idempotency. Верифікувати restart/resume. Розгорнутий Worker окремо від Vercel frontend. Доказ у логах, а не у словах.

### Gate E — ML/Edge

Real data training, calibrated OOS, shadow comparison, fee-aware outcomes. Якщо статистичної переваги немає — це чесний негативний результат і треба лишити Paper/Shadow, а не викручувати score thresholds.

**Вимога щодо delivery:** закрити Gate A перед вважанням системи готовою для Paper; Gates B–D — для коректного статусу «Agentic Research System»; Gate E — для будь-яких тверджень про прогнозну якість. Якщо ресурсів бракує, доставити завершену безпечну фазу і назвати інші блокерами, а не видавати весь обсяг за DONE.

## 9. ACCEPTANCE: ТЕСТИ, ЯКІ АГЕНТ ЗОБОВ'ЯЗАНИЙ ПОКАЗАТИ

Відповідь «113/113 tests, build succeeded» **НЕ ПРИЙМАЄТЬСЯ** без наступних доказів. Для кожного сценарію — сценарій/fixture або реальний API, expected result, фактичний результат, log/trace і посилання на тест/коміт.

| ID | Сценарій | Мінімальний доказ, без якого — FAILED |
|---|---|---|
| AT-01 | BTC на 1H/4H змінює режим, ALT ціна стоїть | Перезапущено перевірку ALT signals+trades, із correlation data та revision history |
| AT-02 | BTC росте, ALT відстає і tape sells | AI запитує додатковий tool, не просто відправляє шаблонний BUY |
| AT-03 | Новина CPI/FOMC впливає на BTC/ALT/XAU | Реальний ingestion, URL, timestamp, relevance, thesis reevaluation |
| AT-04 | News provider offline | `UNAVAILABLE`, не «критичних новин немає» і не false-positive PASS |
| AT-05 | Запит «ADX на 4H, потім перевір divergence» | LLM ініціює `list_indicators` та `compute_indicator`, дані й timeline існують |
| AT-06 | Інший запит «чи є whale sell absorption?» | Вибрано іншу послідовність tools: orderflow/tape/depth/OI, не ті ж 4 виклики за шаблоном |
| AT-07 | Суперечність 1D up / 15M down | Повторна перевірка TF + чесна невизначеність або WAIT |
| AT-08 | OHLCV не вистачає на EMA200 | `INSUFFICIENT_DATA`; ніяких згенерованих значень EMA200 |
| AT-09 | Bybit offline/404 для символу | Немає synthetic ticker/TP/SL, немає live-ready signal |
| AT-10 | Відсутній LLM API key | Явне no-agent/limited mode, NO_TRADE за політикою, не rule fallback pretending AI |
| AT-11 | ML service offline/без `.cbm` | `MODEL_UNAVAILABLE`, null calibrated probability; правильний independent gate |
| AT-12 | Вхідні рівні мають RR=0.8 | `RR=0.8` і reject, не переписування на 2.2 |
| AT-13 | Copilot на тих самих цінах із різною історією | Структурно різні рішення або WAIT — не фіксований 1.8% SL/3.2% TP1 |
| AT-14 | 30, 50, 200 OHLCV; sweep з підтвердженим баром | Валідні індикатори й SMC, без lookahead і include-current pivot bug |
| AT-15 | >50 активних AI-сесій | Усі отримують справедливе обслуговування, немає starved sessions |
| AT-16 | Закрито браузер, змінено BTC і відкрито Paper LONG | Worker створює evidence-backed повідомлення до відкриття браузера |
| AT-17 | Перезапуск Worker/дві конкурентні ідентичні події | Рівно один event, idempotent run/reply, dedup підтверджено DB |
| AT-18 | У чаті 120+ повідомлень, retry SSE, Enter/scroll | Жодних дублікатів, не рухається зовнішня сторінка, progress правдивий |
| AT-19 | Два користувачі/два акаунти | Недоступні чужі trade/session/tool logs, SQL RLS tenant boundary tested |
| AT-20 | Kill switch/SL protection/negative EV/unknown news policy | Усі entry paths блокують там, де наказує політика; реальні live API не викликані у тесті |
| AT-21 | Перевірити «агресивність покупців» | Вона обчислена з executed prints, не з standing bids/asks; CVD window explicit |
| AT-22 | Сигнали 100+ історичних кейсів із fee/funding | Shadow vs baseline metrics на OOS та різних market regimes; жодних заяв про win-rate без доказу |
| AT-23 | XAUUSDT під час макро-релізу | Враховано відповідний macro/benchmark, а не сліпо BTC regime |
| AT-24 | Виконання LLM tool loop | Trace `plan -> toolA -> observe -> toolB -> synthesize`, конкретні артефакти і tool outputs |
| AT-25 | Реальна production готовність | Worker heartbeat, ML availability, OpenRouter selected model, news-source status, version matching migrations; жодної здогадки |

**Не занижуй цей список до 5 «позитивних» unit-тестів.** Тести мають охоплювати unit, integration, mocked exchange, staging Postgres/Supabase, deterministic replay і production runtime verification там, де дійсно є доступ. У тестах жодного live entry/exit.

## 10. ФОРМА ЗВІТУ — ВИКОНАТИ ТОЧНО, БЕЗ МАРКЕТИНГОВИХ ЗВІТІВ

Створи у репозиторії `docs/AGENTIC_TRADER_IMPLEMENTATION_REPORT.md` та `docs/AGENTIC_TRADER_ACCEPTANCE_MATRIX.md`. У фінальній відповіді обов'язково:

1. **HEAD до/після:** hash, branch, список комітів, diff по файлах, які з перерахованих дефектів залишилися.
2. **P0 matrix:** кожен `P0-01 ... P0-12` із `DONE|PARTIAL|BLOCKED|NOT_STARTED`, файл:рядок, зміна логіки, тест.
3. **Acceptance matrix:** кожен `AT-01 ... AT-25` із `PASS|FAIL|NOT_RUN|BLOCKED`, точна команда/fixture, фактичний observed output, logs/artifact links. НЕ писати PASS без фактичного тесту.
4. **Реальний AI trace:** один BTC-driven rescan, один user question із dynamic indicator tools, один contradictory-evidence replan, одна news-driven reassessment. Модель і endpoint явно названі, tokens/latency/cost — якщо доступні.
5. **Data provenance:** джерела Bybit/News/Macro, source freshness, indicator catalog, coverage/backfill, unsupported assets, health statuses.
6. **Risk regression:** докази що Paper/Demo/Live, SL/TP/trailing, manual/autopilot, RLS, balance, partial-close працюють або що НЕ тестувалося.
7. **DB migrations:** файли, перевірка preconditions, deployment steps, rollback; не вдавати, що SQL застосований у Supabase, якщо доступу до проєкту немає.
8. **Production deployment:** worker process/health, Vercel commit, ML service/model loaded, OpenRouter selected actual model, news feed; окремі `VERIFIED` та `UNKNOWN`.
9. **Known limitations:** чесний перелік того, що залишилося. Формулювання «100%» заборонене без evidence.
10. **Next actions:** лише те, що фактично потрібно власнику запустити/налаштувати. Без передачі секретів у чат; не публікувати keys.

### Контрольна перевірка перед оголошенням «ГОТОВО»

На ці запитання відповідай лише `так, доказ: ...` або `ні, blocker: ...`:

- Чи може AI сам вибрати індикатор, якого немає в початкових чотирьох викликах, отримати і інтерпретувати його справжні числові значення?
- Чи може BTC-шок змінити рішення щодо альткоїна навіть без локального пампу?
- Чи може повноцінний news event змусити AI переоцінити вже відкриту позицію?
- Чи є реальні, а не вигадані probabilities і data provenance для кожного сигналу?
- Чи не дає fallback на offline AI/ML фальшивих TRADE-сигналів?
- Чи живе Agent Research/Worker без браузера, з dedup, persistence та моніторингом?
- Чи не може AI в обхід незалежної торгової policy сам відправити live ордер?
- Чи є реальні інтеграційні докази, а не лише `npm run build`?

**Якщо хоча б один ключовий пункт не доведений — не заявляй «Agentic Trader реалізовано повністю».** Поясни фактичний статус і зроби все, що безпечно можливо в наявному середовищі.

---

# ДОДАТОК А. ДЕТАЛЬНИЙ НЕЗАЛЕЖНИЙ АУДИТ GITHUB — ФАКТИ І КОНКРЕТНІ ФАЙЛИ

Нижче наведена початкова версія аудиту (без скорочень). Вона є **фактологічним обґрунтуванням** цього контракту, а не альтернативним необов'язковим планом. Якщо в базовому файлі є м'якше формулювання, застосовується суворіша умова вище; якщо актуальний код уже змінений, підтверди це тестом і зазнач коміт.

# VEXQORA — незалежний GitHub-аудит та ТЗ на Agentic Trader 2.0

**Дата:** 28.10.2026  
**Репозиторій:** https://github.com/s1zeNof/Vexqora  
**Перевірено:** `main` HEAD `7f37dde86c2bd7f64cd64e10b1c684c4a7dbcf72`  
**Метод:** статична перевірка фактичного коду в GitHub. Production Vercel/Worker/Supabase/OpenRouter/Bybit та реальні результати угод недоступні в цьому аудиті. Тому фактичну якість сигналів і deployment не можна вважати підтвердженими.  
**Потрібний результат:** незалежна від UI, постійно працююча багаторівнева система, у якій LLM Lead Trader планує дослідження, динамічно викликає перевірені tools/субагенти, формує й переоцінює trade thesis, а суворий детерміністичний Risk/Execution Engine має остаточне право блокувати ордер.

## 1. Підтверджені причини незадовільної поведінки

### A. LLM не керує дослідженням — hardcoded pipeline

- `packages/trading/src/agent-runtime.ts`: `orchestrateTradeAnalysis()` завжди викликає **ті самі чотири** `runSubagent`: structure, order_flow, risk, news. Після цього `leadVerdict` визначається фіксованими `if/else`; `confidencePct = round(40+50*evidenceCompleteness)` — не win probability.
- `packages/trading/src/nemotron.ts`: `callNemotron()` має інтерфейс `messages`, `temperature`, `maxTokens`, `model`; **не приймає `tools` і не має циклу tool calls**. Це чат-комплішн, не tool-using agent.
- `apps/web/src/app/api/ai/companion/chat/route.ts`: підставляє вже готовий `synthesis` у промпт; fallback за `lower.includes(...)`. Прогрес-етапи SSE — це етапи конвеєра, а не агент, який сам обирає наступне дослідження.
- `apps/worker/src/market-events-scheduler.ts`: події створюються фіксованими порогами і текстовими шаблонами; цей scheduler **не проводить LLM-реаналіз ринку при значущій події**.

**Потрібно:** Lead Trader — planner/actor з реальною підтримкою tool/function calling, dynamic tool selection, evidence checks, bounded replanning, refusal on missing data. LLM не має безпосереднього доступу до секретів, SQL, виконання довільного коду чи Bybit write API.

### B. Сигнали тригеряться локальним імпульсом, не глобальним режимом

- `packages/trading/src/pulse.ts`: 24h turnover >=500k; impulse за 5–60s >=0.70% / >=1.10% / >=1.80% залежно від turnover; без аномалії немає deep-dive.
- `apps/worker/src/pulse-scanner.ts`: обробляє лише `anomalies.slice(0,3)` на цикл; для кожного активного account окремо викликає `generateNemotronOpportunity()` (зайві LLM-витрати), у LLM ідуть переважно 25 свічок 15M + локальний order flow. Відсутній глобальний `BTC_regime` або регулярна переоцінка всіх кандидатів при зміні BTC.
- `packages/trading/src/pulse.ts`: `fetchTopUniverseOpportunities()` виключає BTCUSDT/ETHUSDT зі **списку кандидатів** (можна залишити для alt-only view), але глобальна система все одно зобов'язана збирати BTC/ETH як benchmark. Рейтинг кандидатів залежить від turnover/24h% більше, ніж від незалежного структурного аналізу.
- `apps/web/src/app/api/market/scan/route.ts`: UI scan бере лише top 3 кандидати, по 50 15M свічок кожному. Немає всебічного BTC/macro context перед генерацією.

**Потрібно:** market-wide regimes та окремий high-liquidity moderate scanner; trigger re-analysis усіх релевантних відкритих/preview сигналів при BTC impulse, regime shift, news shock або новій структурі, а не тільки при пампі конкретної монети.

### C. Критично: hardcoded цілі та win probabilities у новому Copilot

- `packages/trading/src/copilot-analyst.ts`: три сценарії (conservative/momentum/deep_swing) збираються **до виклику LLM** з фіксованими процентами (SL 1.8%/2.4%/3.4%; TP1 3.2%/2.2%/5.2%, інші цілі також фіксовані). `winProbabilityPct` жорстко задані **74/64/69**.
- Кращий сценарій вибирає просте `bestScenarioId` правило, після чого LLM пропонується довести його оптимальність; це confirmation bias в prompt.
- `calculateCopilotScenarios()` за замовчуванням вибирає LONG, якщо не виконана сувора bearish умова, замість відхилення за відсутності edge.
- `fetchCopilotMarketData()` при відсутності справжньої ціни підставляє BTC **67500**, ETH **2600**, SOL **175** або **10** для інших; high/low також оцінюються від ціни через `*1.03`, `*0.97`. НІКОЛИ не демонструвати ці значення як live.
- `buyerAggressionPct` у цьому файлі виведено з **лімітного обсягу bid/ask у стакані**, а не агресивних executed trades. Це термінологічно та фінансово хибне вимірювання.
- Fallback текст називає результат «чистим очікуваним профітом», гарантує безпечність плеча і беззбитковість після TP1 без доказу fee/slippage/protection execution; прибрати.

**Потрібно:** full validation; AI може пропонувати рівні, але вони мають бути прив'язані до реальних структури/ATR/liquidity і перевірені незалежним validator. Розрахунок кількості, fee, funding, slippage, liquidation, risk budget — тільки детерміністично. Ніяких win probability без OOS calibration/model/version.

### D. Signal generator частково справжній LLM, але неповний контекст

- `packages/trading/src/nemotron.ts::generateNemotronOpportunity()` реально викликає LLM і може прийняти її TRADE/NO_TRADE, але передає тільки 6 останніх 15M свічок + стислий microstructure; у промпті просить `smc1D`/`smc4H`, хоча не передає відповідні 1D/4H дані. Це спонукає до вигаданого HTF reasoning.
- `generateNemotronOpportunity()` підставляє `rr >= 1 ? rr : 2.2`: якщо обчислене співвідношення погане, `riskReward` у відповіді може бути **підвищене до 2.2 без зміни цін TP/SL** — усунути негайно.
- Якщо LLM виклик не вдався, повертається `generateOpportunityFromTicker(...)`, який може сформувати сетап із правил без схвалення LLM.
- `packages/trading/src/ai-copilot.ts::calculateSMCContext()` обчислює `swingHigh/Low` на вікні, що включає last bar, а потім тестує `last.low < swingLow` або `last.high > swingHigh`, що неможливо для коректних OHLC. Також для <3 свічок `sweptLiquidity:true` і штучно оцінений ATR.
- `packages/trading/src/ai-learning.ts` — фіксовані штрафи (`baseWinRate 72` тощо), а не навчання. `packages/trading/src/memory.ts` містить `isEmpirical:false`, але текстові «27 із 37 історичних випадків» і winRate 73% та подібне можуть потрапляти в prompts як нібито підтверджені факти. Вилучити такі неемпіричні статистики з production prompts.

### E. Немає справжнього News Intelligence

- `packages/trading/src/news.ts`: лише typed event model, symbol filtering, keywords classification.
- `apps/web/src/app/dashboard/signal/[id]/ai-companion-actions.ts` створює `evaluateNewsRiskForTrade(normSymbol, [], "UNAVAILABLE")` — подій у чаті ніколи немає.
- Не виявлено production RSS/news/economic calendar collector у дереві репозиторію.

**Потрібно:** зовнішні перевірені джерела → ingestion → нормалізація/дедуп → relevance/impact/exchange/symbol/sector mapping → confidence/age/source URL → інструмент `search_news`, `get_economic_calendar`, `get_exchange_announcements`; якщо офлайн, `UNAVAILABLE`, не «немає важливих новин».

### F. Немає обов'язкового BTC + macro контексту

Жоден критичний `generateNemotronOpportunity()` чи `orchestrateTradeAnalysis()` не приймає benchmark BTC regime/correlation/beta/lead-lag/breadth. Потрібний `GlobalMarketContext` із BTC/ETH: 1D/4H/1H/15M, BTC relative strength, rolling BTC-alt correlations (кілька часових вікон), lead/lag, funding/OI/volume, alt breadth, market-volatility regime. Для XAUUSDT/не-крипто продуктів відповідні benchmarks (XAU/USD, DXY, US Treasury yields, macro) важливіші за сліпе застосування BTC.

### G. «Будь-який індикатор» поки не існує як агентний інструмент

- `packages/trading/src/feature-registry.ts` реалізує базові EMA/SMA/RSI/ATR/MACD/Bollinger і 18 canonical features.
- У `callNemotron()` немає capability registry/tool calling, тому модель не може сказати «завантажити 200 4H барів і порахувати VWAP/ADX/Ichimoku/Volume Profile, а потім перевірити дивергенцію» та отримати результат динамічно.

**Потрібно:** typed `IndicatorRegistry` з capability discovery (`list_indicators`, `compute_indicator`) та верифікованим каталогом; строгі schema/parameter limits, warm-up, OHLCV provenance і тестами еквівалентності. Розширюваний набір популярних індикаторів, а не вимога магічно підтримувати кожен відразу.

### H. ML фактично не доведений у production

- `packages/ml-engine/train_catboost.py` містить trainer; у repo немає `.cbm` артефактів моделей. За замовчуванням trainer запускається тільки для BTCUSDT LONG/SHORT.
- `packages/ml-engine/server.py` за відсутності моделі видає `StatisticalBayesian` — rule heuristics; `/health` не доводить готовність model weights.
- `packages/trading/src/ml-bridge.ts` звертається до `ML_SERVICE_URL`, за відсутності — `127.0.0.1:8000`, timeout 400ms. За відсутності inference `NO_TRADE`; `generateNemotronOpportunity()` на LLM error може піти іншим fallback path.

**Потрібно:** розгорнутий сервіс inference, model registry version+trainedAt+dataset+backtest/out-of-sample+calibration, asset/timeframe applicability, no synthetic train, shadow/live evaluation, fees/funding/slippage, walk-forward + purged temporal CV, drift and rollback. 50% виграних угод не підтверджує й не заперечує edge без payout ratio і витрат.

### I. Execution gates не проходять повний доказовий контроль

`packages/trading/src/ensemble-gate.ts::verifyExecutionGates()` має default `gate1Passed=true`, `gate2Passed=true`, `gate4Passed=true` та опційні `evUsd`, `mlDecision`, `structureTrend`, `hasCriticalNews`. `packages/trading/src/executor.ts::submitEntry()` передає переважно price/SL/TP/RR; це **не підтвердження фактичного проходження ML/news/structure gates**. Чітко розділити невід'ємні safety guards і advisory model-based gates, ввести `PASS/REJECTED/UNKNOWN`, сувору policy engine для Live, no bypass when missing critical facts.

## 2. Цільова архітектура Agentic Trader 2.0

### A. Global Market Intelligence (збір один раз на символ/інтервал)

- Bybit Market Data: tickers, real closed klines multi-TF, L2 snapshots/updates, public trade tape, OI, funding, liquidation if available; дані з timestamps, freshness, source и validity; WS ingestion + REST reconciliation.
- BTC/ETH Regime, alt breadth, sector leadership, rolling correlation/beta, risk-on/risk-off states.
- Verified News & Macro: exchange announcements, macro calendar, provider/news URLs, `firstSeenAt`/`publishedAt`, dedupe, relevance. Не використовувати пустий feed як позитивний сигнал.
- Feature / Indicator Tool Registry: standardized input `symbol/exchange/timeframe/parameters/asOf`, output `value/dataStatus/candlesUsed/source/updatedAt/versions`.
- Persistent structured market snapshots keyed by symbol/timeframe/asOf; event bus for invalidation of stale decisions.

### B. Реальний AI Lead Trader із tool-calling loop

1. User request або reasoned event відкриває `AgentRun` із ціллю: `find opportunities` / `reassess signal` / `manage existing trade` / `explain decision`.
2. Lead Agent **сам** обирає потрібні read-only tools з оголошеного каталогу: `get_global_regime`, `get_btc_dependency`, `get_closed_klines`, `get_market_structure`, `list_indicators`, `compute_indicator`, `get_order_flow`, `get_whale_activity`, `get_funding_oi`, `search_news`, `get_risk_state`, `get_trade_history`, `run_historical_analogue_search`, `get_ml_prediction`, `simulate_scenarios`.
3. Виконує/делегує спеціалізовані задачі: Regime/Correlation, Quant/Indicators, Structure/SMC, Order Flow/Whales, News/Macro, Derivatives, Historical Research, Risk. Не всі субагенти запускаються за замовчуванням: лише релевантні, з можливістю донабору доказів.
4. Перевіряє невідповідності. Наприклад, LONG по альту при BTC impulse та CVD-selling: повторно оцінює 1H/4H, BTC beta і order flow; не видає високий confidence автоматично.
5. Produces structured recommendation with `decision: LONG/SHORT/WAIT/NO_TRADE/REASSESS/EXIT_REVIEW`, entry/SL/TP *suggestions*, scenarios, invalidation triggers, supporting/opposing evidence, source timestamps, unknowns, policy decision and TTL.
6. Детерміністичний validator незалежно перевіряє symbol, tickSize/stepSize, source freshness, risk budget, liquidation, slippage/fees, order size, RR, account status, model provenance, kill switch. Агент **не може** його переписати промптом.
7. Persist all runs/tool calls/evidence/versions, show real runtime progress (не fake predetermined phase labels), work after browser close, dedupe/cooldown and notification preferences.

**Agent tool loop limits:** max depth 2–3, max 8–15 tools per decision, per-user budget, max runtime, concurrency locks, read-only tools by default; idempotent event triggers, circuit breaker, explicit failure/UNAVAILABLE. Never expose API keys in tool inputs to LLM. No arbitrary production code execution or sandbox escapes.

### C. Запуск дослідження без 0.7% локального pump

Тригери: BTC/ETH regime shift, significant benchmark momentum, sector rotation, new 1H/4H BOS/CHOCH, price+volume breakout, order flow imbalance, whale prints, derivatives OI/funding anomaly, news shock, near TP/SL, time-based scheduled rescan for top liquidity universe, pending signals expiring, post-trade. Separate discovery triggers vs risk/monitor triggers.

### D. Постійний AI супровід відкритої позиції

Сесія має `thesis`, `entry_context`, `risk_policy`, `invalidation_conditions`, `last_snapshot`, `last_reassessment`, `state: valid/weakened/invalidated/unknown`, `expiry`. При зміні BTC, структури, новин, volume/OI — agent re-assesses. Повідомлення пояснює **що змінилося від минулого рішення**, чому, як це впливає на ймовірні сценарії, що підтверджує/спростовує, що НЕ відомо. Не повторювати ціну/Entry/SL без потреби.

### E. Контроль автономної торгівлі

- Рекомендації, paper shadow та simulation — default.
- Реальні entry/exit/modify тільки при окремій явній політиці користувача на конкретний аккаунт, інструменти, максимальну експозицію, леверидж, денну просадку, cooldown, min data quality і emergency kill switch; кожна дія під independently tested risk engine.
- У тестах **жодного** live ордера. Rollback and audit replay.

## 3. План розробки — порядок обов'язковий

### P0 — Safety & Truthfulness (не пропускати)
1. Заборонити live використання synthetic price, synthetic highs/lows, synthetic pseudo-performance; remove Copilot fabricated `winProbabilityPct:74/64/69`; off-LLM fallback => `NO_TRADE / DATA_UNAVAILABLE` замість auto signal.
2. Виправити `rr >=1 ? rr : 2.2`; справжній risk reward derives from validated price levels.
3. Виправити `calculateSMCContext()` lookback excluding current candle, lookahead checks, closed candles.
4. Відділити stop/kill/risk checks від AI estimates; fix fail-open gates; real live execution tests only through mocked exchange.
5. Data quality fields + provenance for every tool, and explicit errors/unknown.
6. Перевірити `trades.tp1` schema drift, RLS, `client_message_id` concurrency dedup з попереднього аудиту, не створюючи нових ризиків для існуючих торгових рядків.

### P1 — Real Intelligence Data
7. Create market data ingestion, global BTC/ETH regime, correlation/beta, sector breadth, multi-TF **closed** bars.
8. News + macro collector with sourced impact mapping and status.
9. Extend Indicator/Feature Registry and historical analogues store; bounded read-only tool APIs.
10. Validate whale activity on executed trades and order book separately, avoid iceberg claims from a one-time snapshot.

### P2 — Genuine Agent Runtime
11. Upgrade `callNemotron`/LLM provider abstraction to tool/function calling with validated arguments; dynamic plan/execute/observe/replan/synthesize cycle.
12. Real specialist subagents on demand, evidence-based conflict analysis, no mandatory fabricated confidence.
13. Plug Lead Agent into signal discovery, signals reassessment and trade companion; exactly one canonical analysis engine for all paths (no three divergent pseudo-AI implementations).
14. Expose actual tool lifecycle in AI chat; no fake waiting steps.

### P3 — Autonomous Monitoring & Trade Thesis
15. Market event bus + persistent monitored universe and sessions; worker heartbeat, retries, dedup, budget caps.
16. Re-evaluate preview signals on BTC/macro/market regime and retire/cancel outdated recommendations.
17. Re-evaluate active paper/live trades without browser, provide evidence-rich alerts; live trade changes only under explicit policy and independent protection.

### P4 — Data-driven Edge
18. Train asset/regime-aware models on real historical data and actual outcomes, versioned OOS and walk-forward validation, probability calibration & drift monitoring.
19. Paper-shadow A/B compare fixed-rule baseline vs actual agent vs agent+ML; evaluate **expectancy after fees/slippage/funding**, max DD, calibration, directional accuracy, precision of alerts, time to invalidation, trading frequency, no-trade rate.
20. Only discuss moving to Live after documented out-of-sample evidence and user approval.

## 4. Acceptance / Proof (do not settle for typecheck/build)

- **Tool autonomy:** 5 diverse user questions + market events; logs show different dynamically selected tools based on needs; AI can request a *new indicator* and actually obtain audited result; no fake tool event.
- **BTC trigger:** simulate BTC 4H regime reversal with alt candle unchanged; affected preview signals/active positions are reassessed, thesis changes or explicitly remains valid with evidence.
- **News trigger:** ingest signed exchange announcement with URL+timestamp; verify source and reassess relevant symbols; offline => UNKNOWN; outdated news not silently treated fresh.
- **Order flow:** L2 bid/ask liquidity vs executed buyer aggression distinguish correctly, CVD window explicit, no iceberg claim without sufficient longitudinal evidence.
- **Signal generation:** 10 distinct real historical contexts with hardcoded preset percentages removed; independent deterministic TP/SL validator checks RR and fees. "NO_TRADE" is a valid outcome; no automatic LONG default.
- **LLM unavailable:** no fabricated current prices, win rate, phantom confidence, signals from heuristic fallback pretending to be model-backed.
- **Worker:** verified 24/7 in deployment, >50 sessions fairness/pagination, idempotency on restart, no duplicate notices, no unbounded LLM per user.
- **Risk:** all order entry paths reject disallowed actions, no live exchange calls in CI; stage migrations on production-schema clone and DB backup.
- **Performance:** compare end-to-end trade outcomes after costs and quality of decisions over enough samples, not only 113 unit tests or 50% win rate.

## 5. Files to inspect and refactor

- `packages/trading/src/copilot-analyst.ts`
- `packages/trading/src/nemotron.ts`
- `packages/trading/src/agent-runtime.ts`
- `packages/trading/src/pulse.ts`
- `apps/worker/src/pulse-scanner.ts`
- `apps/worker/src/market-events-scheduler.ts`
- `apps/web/src/app/api/market/scan/route.ts`
- `apps/web/src/app/api/ai/companion/chat/route.ts`
- `apps/web/src/app/dashboard/signal/[id]/ai-companion-actions.ts`
- `packages/trading/src/feature-registry.ts`
- `packages/trading/src/news.ts`
- `packages/trading/src/microstructure.ts`
- `packages/trading/src/ai-copilot.ts`
- `packages/trading/src/ai-learning.ts`
- `packages/trading/src/memory.ts`
- `packages/trading/src/ml-bridge.ts`
- `packages/ml-engine/server.py`
- `packages/ml-engine/train_catboost.py`
- `packages/trading/src/ensemble-gate.ts`
- `packages/trading/src/executor.ts`
- `apps/worker/src/runner.ts`
- `supabase/migrations/` (incremental only, no all-in-one reset)

**Non-negotiables:** не ламати Paper/Demo/Live, SL/TP, partial close, trailing, manual/autopilot, RLS і розмежування акаунтів; не стирати баланси/угоди; окремі PR/коміти за етапами з тестами, інструкцією для міграцій і rollback; production claims only with runtime proof.
