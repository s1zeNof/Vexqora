# Vexqora Agentic Trader 2.0 — Незалежний повторний GitHub-аудит

**Дата:** 28.10.2026  
**Репозиторій:** https://github.com/s1zeNof/Vexqora  
**HEAD:** `c9a40d82c8d87adfa5db2d9c383933bbebb2ed51`  
**Висновок:** **NOT ACCEPTED / P0 невиконані.** Розробник заявив «12/12 DONE, 25/25 PASS», але ці статуси не підтверджуються фактичними production call paths. Аналіз зроблено за GitHub-кодом; самостійних production-E2E, Supabase та live Worker тестів не проводили.

## Що справді покращено

- Додано `global-regime.ts`, `tool-registry.ts`, `news-feed.ts`, `model-registry.ts` і додаткові тести.
- У Copilot прибрано фіксовані `74/64/69%`; ML повертає `null`, якщо підтверджена модель недоступна.
- `nemotron.ts` більше не підміняє фактичний Risk/Reward значенням 2.2 і повертає захисний `NO_TRADE` при помилці LLM/JSON.
- З'явився BTC 15M режимний сигнал у фоні, проте він не виконує повноцінної переоцінки позицій.

## Критичні невідповідності — блокувальні

### P0-01. Планувальник інструментів усе ще на if/else

`packages/trading/src/agent-runtime.ts`, `executeLeadTraderDynamicLoop` (~495–509):

```ts
if (query.includes('adx') || query.includes('індикатор') || query.includes('divergence'))
  plan.push('list_indicators', 'compute_indicator:ADX');
else if (req.objective === 'whale_check' || query.includes('whale') /* ... */)
  plan.push('get_orderflow', 'compute_indicator:VWAP', 'get_market_structure');
```

Реального model-driven tool calling тут немає. LLM не планує та не переплановує інструменти. Два тригери replan — також жорсткі умови. **Вимога Agentic Lead Trader не виконана.**

### P0-02. Динамічний висновок не впливає на головний торговий вердикт

`packages/trading/src/agent-runtime.ts`, `orchestrateTradeAnalysis` (~678–765): виконуються чотири старі субагенти + новий `executeLeadTraderDynamicLoop` у `Promise.all`. Але фінальний `leadVerdict` обчислюється лише зі старих 4; `dynamicLoop.leadVerdict` для рішення ігнорується. У новий цикл передаються `klines` без `btcKlines`, `ethKlines`, `trades`, `userQuery`, отже production BTC/ETH context і tape часто `INSUFFICIENT_DATA`. **Новий цикл декоративний щодо фінального verdict.**

### P0-03. «Live news» — fixture із фальшивим ONLINE

`packages/trading/src/news-feed.ts` (~50–91): типовий провайдер не виконує жодного HTTP запиту. Повертає `status: 'ONLINE'`, порожні `events`, штучний CPI `now + 24h` зі статичними `forecast: '2.8%'`, `previous: '2.9%'`. `news-feed.test.ts` використовує `MockMacroFeed` із вручну створеною CPI-новиною, а не справжній ingestion. **Живих новин немає.**

### P0-04. Default execution gates фактично fail-open

`packages/trading/src/ensemble-gate.ts` (~77–81):

```ts
allowUnknownStructureForEntry: true,
allowUnknownMlForEntry: true,
allowUnknownNewsForEntry: true
```

`apps/worker/src/runner.ts` і `packages/trading/src/executor.ts` викликають `verifyExecutionGates` **без явної strict policy і без доказів ML/Structure/News**. Статуси UNKNOWN допускають фінальний `passed:true`. `ensemble-gate.test.ts` прямо називає default **permissive policy**. Це суперечить тексту «fail-closed в production». **P0: нові входи не повинні проходити вимоги, які не перевірено.** Захисні виходи зберегти доступними.

### P0-05. BTC event не переоцінює активні сигнали

`apps/worker/src/pulse-scanner.ts` (~37–69) бере лише BTC 15M (30 барів). Коли змінюється тренд, робить `INSERT chat_messages` з текстом «Всі активні гіпотези альткоїнів проходять переоцінку», але **не викликає per-trade re-analysis**, не оновлює persisted thesis, не змінює status/decision сигналів. Відсутня реальна обробка BTC regime flip → active position review.

### P0-06. Індикатор ADX не є класичним ADX

`packages/trading/src/tool-registry.ts` (~350–400): `ADX` обчислюється як обмежений proxy із net close movement / average true range; немає +DM/-DM, DI, DX і Wilder smoothing. Повертається як `ADX_14`/`OK`. Тест перевіряє **виклик**, не математичну коректність. Потрібно запровадити справжній індикатор із parity тестами незалежної еталонної реалізації.

### P0-07. Синтетична market breadth видається за ринок

`packages/trading/src/tool-registry.ts` (~205):

```ts
marketBreadthPct: btcRegime.trend === 'bullish_trend' ? 68.5 : 34.0
```

Це вигадане значення. Справжню ширину ринку слід рахувати за universe ticker data або повертати `null/UNAVAILABLE`, а не `OK`.

### P0-08. Торгова пам'ять не персистентна

`LeadTraderToolRegistry`: `private thesisStore = new Map<string, TradeThesis>()`. За замовчуванням при кожному `executeLeadTraderDynamicLoop` створюється `new LeadTraderToolRegistry()`, `thesisId` включає `Date.now()`, `revision:1`. Дані не переживуть повторний HTTP запит / Worker restart. Потрібна БД з revision history, diff та історією інвалідацій.

## Інші суттєві проблеми

- `packages/trading/src/copilot-analyst.ts` досі через heuristic `bullishScore/bearishScore`, динамічні SL/TP множники і простий `bestScenarioId` до LLM вирішує, які сценарії пропонувати. Це може бути candidate generator, але не самостійний Lead Trader.
- `packages/trading/src/model-registry.ts`: `weightsHash:null`, `trainedAt:null`, `outOfSampleAccuracy:null`, `UNCALIBRATED`, `MODEL_UNAVAILABLE` — зареєстрованого робочого каліброваного CatBoost немає в підтвердженому стані.
- `apps/web/src/app/dashboard/signal/[id]/ai-companion-actions.ts` у системному промпті стверджує, що перенесення SL в breakeven «повністю усуває ризик». Це неправда через fees/slippage/funding/gaps/order failure; також промпт наказує обґрунтовувати LONG vs SHORT у визначений бік до аналізу, створюючи confirmation bias.
- `news-feed.ts` без інтеграції з upstream і `tool-registry.ts` з фальшивим breadth порушують пряму заборону синтетичних production даних.

## Чому «25/25 acceptance tests PASS» не можна прийняти

- **AT-03:** CPI взято з `MockMacroFeed`, не зі справжнього upstream.
- **AT-05:** перевірено тільки факт виклику ADX; не перевірено правильність ADX і 4H source.
- **AT-15:** `apps/worker/src/runner.test.ts` тестує mocked errors, а не 51+ активних сесій/`SKIP LOCKED`.
- **AT-16:** матриця посилається на `npx vitest run apps/worker/src/pulse-scanner.ts` — це source, не test suite; E2E із закритим браузером не доведений.
- **AT-18:** manual UI заявлений без пов'язаних артефактів browser E2E.
- **AT-10:** матриця посилається на `src/nemotron.test.ts`, але такого файлу немає в HEAD.
- **AT-20:** тести strict policy працюють лише коли caller її явно передає; фактичні `runner.ts`/`executor.ts` strict policy не передають.
- Заяву про локальне проходження 138 тестів незалежно не перевірено. Це не означає, що тести не проходять, але не доводить потрібний production E2E.

## Необхідне завдання для розробника — без формального закриття пунктів

**Поточний контракт: REJECTED.** Перед повторним `DONE` необхідно:

1. Побудувати реальний LLM-directed structured tool calling (OpenRouter tool_calls або еквівалент): модель вибирає tool, бекенд валідує й виконує лише read-only інструменти, модель отримує результат і вирішує чи потрібен наступний tool. Містити bounded recursion, timeout, cost, logging.
2. Підключити до реального chat/worker/candidate pipeline. Врахувати `dynamicLoop` у verdict, а не приклеювати його trace збоку. Передавати достовірні BTC/ETH multi-TF, новини, tape, OI.
3. Забезпечити справжній persisted News Collector із джерелом, publishedAt, observedAt, category, relevance, actual vs forecast; виключити fixed CPI/ONLINE з production. Якщо провайдера немає — `NOT_IMPLEMENTED`.
4. Забезпечити **strict defaults** для обов'язкових нових входів, source-backed proof per gate і окремі перевірки actual call sites `executor.ts`, `runner.ts`, manual/auto orders. Не блокувати захисні виходи.
5. Від BTC 4H regime event запустити durable queue повної per-position/per-signal re-evaluation, а не лише повідомлення; підтвердити браузер-закритий E2E.
6. Переписати ADX на Wilder DX/+DI/-DI smoothing, зробити еталонні parity тести; підтримати indicator registry з різними TF та warmup/staleness.
7. Прибрати фальшивий `marketBreadthPct`, hardcoded news і будь-яку фабрикацію market facts. Якщо даних немає — UNAVAILABLE.
8. Зберігати Trader Thesis та її ревізії в БД, зі зміною validity та повним audit trail, idempotency/dedup.
9. Нейтралізувати biased системний промпт та фальшиву тезу, що breakeven усуває весь ризик.
10. Перезаписати Acceptance Matrix: `UNIT_ONLY`, `INTEGRATION_VERIFIED`, `E2E_VERIFIED`, `NOT_TESTED`, `FAIL`. Вимагати докази: фактичний upstream-news response, LLM tool-call trace, worker BTC re-eval trace, Supabase test DB, mockExchange asserting no live order.

### Мінімальна доказова демонстрація для приймання

- Довільний запит по SOL: BTC 4H/1H + verified news + CVD + ADX → **модель** самостійно обирає інструменти → серверний dispatcher виконує → модель аналізує суперечності → повторно запитує дані → persisted thesis змінює вердикт.
- Без локального пампу ALT, BTC regime flip запускає re-analysis позицій після закриття браузера; повідомлення відповідають доказам і не дублюються.
- Без ML/news/structure `NEW_ENTRY` blocked in actual executor/runner; `mockPlaceOrder` not called; захисне закриття залишається доступним.
- News provider offline → чесний `UNAVAILABLE`, ніяких «CPI завтра» на основі `Date.now()+24h`.
- ADX(14) збігається з незалежним еталоном на кількох OHLC наборах.
- Run/Thesis переживає restart Worker/HTTP, перевірено справжньою тестовою БД.

**Додаткові обмеження:** жодних справжніх LIVE-ордерів у тестах; попередньо backup, міграції лише інкрементальні й у правильний Supabase; independent Risk Engine не переписувати як LLM-safety.

**Пакет здачі:** commit SHA, doc + actual code links, real tool-call transcript, persisted DB thesis revision, sample verified news payload, Worker E2E report, `mockExchange` fail-safe tests, чесні PASS/FAIL по кожному AT. Після цього повторний незалежний аудит.
