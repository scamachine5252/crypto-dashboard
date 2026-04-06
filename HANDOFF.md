# CICADA FOUNDATION — Документ для передачи разработки

> Последнее обновление: 2026-04-06

---

## 1. О проекте

**CICADA FOUNDATION** — внутренний дашборд для крипто-хедж-фонда. Отслеживает PnL, балансы и историю сделок по нескольким аккаунтам на биржах Binance, Bybit, OKX и MEXC.

**Что умеет:**
- Показывать балансы и ключевые метрики (Sharpe, Sortino, MDD, Win Rate и др.) по всем аккаунтам
- Строить графики эквити-кривых с нормализацией к нулю
- Хранить историю сделок и синхронизировать их из бирж через CCXT
- Управлять API-ключами (хранятся в Supabase в зашифрованном виде AES-256-GCM)
- Два визуальных режима: Wintermute (тёмная тема) и Cicada (светлая)
- Full History Sync для MEXC: двухэтапный процесс через `/api/sync/mexc/chunks` + `/api/sync/mexc/full`

**Текущий статус:** MEXC полностью интегрирован (адаптер + sync routes). Все баги маппера MEXC исправлены (pnl, quantity, contractSize, openedAt/closedAt, fees). Уникальный индекс обновлён: теперь `(account_id, symbol, opened_at, closed_at)`. 454 теста проходят. Следующий крупный блок — подключение реальных данных к дашборду.

---

## 2. Стек технологий

| Технология | Версия | Роль |
|---|---|---|
| Next.js | 15.x (App Router) | Фреймворк (SSR + API routes) |
| React | 19 | UI |
| TypeScript | 5.x | Типизация |
| Tailwind CSS | v4 | Стилизация (через @theme в globals.css, без tailwind.config.js) |
| recharts | latest | Графики (ComposedChart, LineChart) |
| CCXT | latest | Унифицированный клиент для бирж (server-only) |
| Supabase | latest JS SDK | База данных + admin client |
| Jest + ts-jest | latest | Тесты (454 passing) |
| jspdf + jspdf-autotable | 4.x / 5.x | PDF-экспорт в /history |
| lucide-react | latest | Иконки |
| clsx | latest | Утилита для className |
| Vercel | — | Хостинг + Cron Jobs |

**Шрифты:** Inter (данные/числа), Space Grotesk (заголовки), Geist Mono (моноширинный)

---

## 3. Инфраструктура

### Vercel
- **Деплой:** автоматически из ветки `main` на GitHub
- **План:** Hobby (ограничения: cron 1 раз в день, регион один)
- **Регион API-функций:** `fra1` (Франкфурт) — **обязательно**, иначе Bybit блокирует запросы через CloudFront
- **Cron Job:** `GET /api/sync` — ежедневно в 09:00 UTC (настроено в `vercel.json`)
- **Конфиг:** `vercel.json` в корне проекта

### Supabase
- **Таблицы:** `accounts`, `balances`, `trades`
- **RLS:** включён на всех таблицах; доступ только через `service_role` (серверный admin-клиент)
- **Клиенты:** `lib/supabase/client.ts` (браузер, публичный ключ), `lib/supabase/server.ts` (сервер, secret key)
- **Миграции:** 001–012 применены

### GitHub
- Репозиторий: `scamachine5252/crypto-dashboard`
- Ветка по умолчанию: `main`
- После каждого коммита — `git push origin main`

### Переменные окружения (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
ENCRYPTION_KEY
```

> `ENCRYPTION_KEY` — 32 байта в hex (64 символа). Используется для AES-256-GCM шифрования API-ключей.
> Никогда не коммитить `.env.local` в git.

---

## 4. Архитектура

### Структура файлов

```
crypto-dashboard/               ← корень проекта (НЕ src/)
├── app/
│   ├── globals.css             ← CSS-переменные тёмной/светлой темы, Tailwind @theme блок
│   ├── layout.tsx              ← корневой layout: шрифты, anti-flash скрипт, <Providers>
│   ├── providers.tsx           ← 'use client'; оборачивает в ThemeProvider + AuthProvider
│   ├── login/page.tsx
│   ├── dashboard/page.tsx      ← балансы, метрики, график PnL
│   ├── performance/page.tsx    ← эквити-кривые, таблица метрик по аккаунтам, SPOT/FUTURES табы
│   ├── results/page.tsx        ← сравнение аккаунтов: BalanceLineChart + PnlHistogramChart + таблица
│   ├── history/page.tsx        ← история сделок: фильтры + таблица + экспорт (default: последние 30 дней)
│   ├── api-settings/page.tsx   ← управление аккаунтами и API-ключами
│   └── api/
│       ├── accounts/           ← GET, POST; [id] DELETE
│       ├── sync/               ← GET + POST: инкрементальная синхронизация всех аккаунтов (last 48h)
│       │   └── mexc/
│       │       ├── chunks/     ← GET: вычислить N окон (chunk_index, since, until) для Full History
│       │       └── full/       ← POST: синхронизировать один 90-дневный чанк; PATCH: отметить завершение
│       └── exchanges/[exchange]/
│           ├── ping/           ← POST: проверка подключения к бирже
│           ├── balance/        ← POST: получить баланс аккаунта
│           └── trades/         ← POST: получить сделки аккаунта
│
├── components/
│   ├── auth/LoginForm.tsx
│   ├── layout/                 ← Header, NavDropdown, FilterBar, AuthGuard
│   ├── ui/PeriodSelector.tsx   ← 1D / Week / Month / Year / Manual
│   ├── metrics/                ← MetricCard, MetricsGrid, BalanceCards, MetricSelector, FuturesMetricsTiles
│   ├── charts/                 ← PnLChart, MetricLineChart, OverlayLineChart, BalanceLineChart, PnlHistogramChart
│   ├── orders/                 ← TradeFilters, OrdersTable, ExportButton, ComparisonTable
│   └── api/                   ← ExchangeCard, ApiKeyInput, StatusBadge
│
├── hooks/useAccountToggles.ts  ← переключение аккаунтов (min 1 активный)
│
├── lib/
│   ├── types.ts                ← ВСЕ TypeScript-интерфейсы
│   ├── utils.ts                ← formatMoney(value, compact, decimals), formatPercent, formatDate, cn
│   ├── calculations.ts         ← все финансовые расчёты (TDD)
│   ├── mock-data.ts            ← детерминированные mock-данные (mulberry32 RNG)
│   ├── auth-context.tsx        ← AuthProvider + useAuth (localStorage)
│   ├── theme-context.tsx       ← ThemeProvider + useTheme
│   ├── nav.ts                  ← NAV_ITEMS — единственный файл для добавления страницы
│   ├── crypto/
│   │   ├── encrypt.ts          ← AES-256-GCM шифрование
│   │   └── decrypt.ts          ← расшифровка с проверкой GCM auth tag
│   ├── supabase/
│   │   ├── client.ts           ← браузерный клиент (публичный ключ)
│   │   └── server.ts           ← серверный admin-клиент (secret key)
│   ├── adapters/
│   │   ├── types.ts            ← ExchangeAdapter интерфейс
│   │   ├── mock.ts             ← MockAdapter (mock-data)
│   │   ├── bybit.ts            ← Bybit CCXT адаптер (server-only)
│   │   ├── binance.ts          ← Binance CCXT адаптер (server-only)
│   │   ├── okx.ts              ← OKX CCXT адаптер (server-only)
│   │   ├── mexc.ts             ← MEXC CCXT адаптер (server-only)
│   │   └── ccxt-utils.ts       ← mapCcxtTrade() — общий маппер сделок
│   └── __tests__/
│       └── calculations.test.ts
│
└── supabase/migrations/        ← SQL-миграции 001–012
```

### Ключевые архитектурные решения

| Решение | Выбор | Причина |
|---|---|---|
| Корень проекта | `app/` (не `src/`) | Стандартный scaffold Next.js |
| Бизнес-логика | только в `lib/` | Компоненты только рендерят, не считают |
| Расчёты | `calculations.ts` | TDD — тесты написаны до реализации |
| Auth | localStorage + React Context | Простота для текущей фазы |
| Стилизация | Tailwind v4 + CSS variables | Нет `tailwind.config.js` |
| Тема | `.light` класс на `<html>` | Anti-flash скрипт в layout предотвращает мигание |
| Навигация | hover на логотип → NavDropdown | Добавление страницы = 1 запись в `nav.ts` |
| CCXT | только на сервере (`server-only`) | Нельзя бандлить в клиент (Turbopack) |

### Поток данных

```
Биржа (Binance / Bybit / OKX / MEXC)
    ↓ HTTPS (серверный API route)
CCXT (lib/adapters/bybit.ts и др.)
    ↓ mapCcxtTrade() / mapMexcPositionHistory()
Supabase (таблицы trades, balances)
    ↓ supabaseAdmin (server-only)
Next.js API routes (/api/sync, /api/accounts...)
    ↓ fetch() из компонентов
Frontend (React компоненты)
```

---

## 5. База данных

### Таблица `accounts`

| Колонка | Тип | Описание |
|---|---|---|
| `id` | uuid PK | Автогенерация |
| `exchange` | text NOT NULL | `'binance'` / `'bybit'` / `'okx'` / `'mexc'` |
| `account_name` | text NOT NULL | Название аккаунта |
| `fund` | text | Название фонда |
| `instrument` | text | `'spot'` / `'futures'` / `'unified'` / `'portfolio_margin'` (nullable, default `'unified'`) |
| `api_key` | text NOT NULL | AES-256-GCM зашифрованный ключ |
| `api_secret` | text NOT NULL | AES-256-GCM зашифрованный секрет |
| `passphrase` | text | AES-256-GCM зашифрованный пароль (только OKX) |
| `account_id_memo` | text | Memo/ID аккаунта (опционально) |
| `is_testnet` | boolean | По умолчанию false |
| `last_full_sync_at` | timestamptz | Время последней полной синхронизации истории (MEXC) |
| `full_sync_failed_count` | int | Количество неудачных чанков при последней полной синхронизации |
| `created_at` | timestamptz | Дата создания |

### Таблица `balances`

| Колонка | Тип | Описание |
|---|---|---|
| `id` | uuid PK | Автогенерация |
| `account_id` | uuid FK → accounts | Каскадное удаление |
| `usdt_balance` | numeric | Баланс в USDT |
| `token_symbol` | text | Символ токена (опционально) |
| `token_balance` | numeric | Баланс токена |
| `note` | text | Заметка |
| `recorded_at` | timestamptz | Время записи |

### Таблица `trades`

| Колонка | Тип | Описание |
|---|---|---|
| `id` | uuid PK | Автогенерация |
| `account_id` | uuid FK → accounts | Каскадное удаление |
| `exchange` | text NOT NULL | `'binance'` / `'bybit'` / `'okx'` / `'mexc'` |
| `symbol` | text NOT NULL | Торговая пара |
| `side` | text NOT NULL | `'buy'` / `'sell'` |
| `trade_type` | text NOT NULL | `'spot'` / `'futures'` |
| `direction` | text | `'long'` / `'short'` / `'unknown'` (nullable) |
| `entry_price` | numeric | Цена входа |
| `exit_price` | numeric | Цена выхода |
| `quantity` | numeric | Объём в базовой валюте |
| `pnl` | numeric | Реализованный PnL (gross: движение цены без учёта комиссии) |
| `fee` | numeric | Комиссия (абсолютное значение) |
| `opened_at` | timestamptz | Время открытия позиции |
| `closed_at` | timestamptz | Время закрытия позиции |
| `raw_data` | jsonb | Оригинальный ответ биржи |
| `created_at` | timestamptz | Дата записи |

**Уникальный индекс:** `trades_account_symbol_opened_closed_idx` на `(account_id, symbol, opened_at, closed_at)` — для upsert без дублей. Добавлен `closed_at` чтобы корректировка `opened_at` (ранее был равен `closed_at` у MEXC) не создавала коллизий.

### Миграции

| Файл | Что делает |
|---|---|
| `001_initial_schema.sql` | Создаёт таблицы `accounts`, `balances`, `trades`; включает RLS; политика `service_role full access` |
| `002_add_instrument_to_accounts.sql` | Добавляет колонку `instrument` (`'spot'`/`'futures'`) в `accounts` |
| `003_fix_column_names.sql` | Переименовывает `label→account_name`, `api_key_encrypted→api_key`, `api_secret_encrypted→api_secret`, `passphrase_encrypted→passphrase`; добавляет `fund` |
| `004_add_account_id_memo.sql` | Добавляет nullable колонку `account_id_memo` в `accounts` |
| `005_add_direction_to_trades.sql` | Добавляет nullable колонку `direction` (`'long'`/`'short'`/`'unknown'`) в `trades` |
| `006_add_trades_unique_constraint.sql` | Уникальный индекс `(account_id, symbol, opened_at)` для дедупликации (заменён в 012) |
| `007_add_unified_instrument.sql` | Добавляет `'unified'` к instrument enum; делает поле nullable с default `'unified'`; обновляет существующие записи |
| `008_add_last_full_sync_at.sql` | Добавляет `last_full_sync_at timestamptz` в `accounts` |
| `009_add_full_sync_failed_count.sql` | Добавляет `full_sync_failed_count int NOT NULL DEFAULT 0` в `accounts` |
| `010_add_portfolio_margin_instrument.sql` | Добавляет `'portfolio_margin'` к instrument enum (для Binance PM аккаунтов) |
| `011_add_mexc_exchange.sql` | Добавляет `'mexc'` к exchange CHECK constraint на `accounts` и `trades` |
| `012_add_closed_at_to_unique_constraint.sql` | Заменяет индекс 006: новый `(account_id, symbol, opened_at, closed_at)` |

### RLS политики

Все таблицы имеют одну политику: `service_role full access` — полный доступ только для серверного admin-клиента. Анонимные и обычные пользователи заблокированы.

---

## 6. Безопасность

### Шифрование API-ключей

- Алгоритм: **AES-256-GCM** (аутентифицированное шифрование)
- Реализация: `lib/crypto/encrypt.ts` и `lib/crypto/decrypt.ts`
- Каждый вызов `encrypt()` генерирует случайный IV — одинаковый ключ → разные шифротексты
- GCM auth tag: при расшифровке проверяется целостность данных (tamper detection)
- Ключ шифрования: переменная `ENCRYPTION_KEY` (32 байта в hex), только на сервере
- Зашифрованные поля (`api_key`, `api_secret`, `passphrase`) **никогда** не возвращаются клиенту

### Server-only CCXT адаптеры

- Все файлы `lib/adapters/*.ts` начинаются с `import 'server-only'`
- `next.config.ts`: `serverExternalPackages: ['ccxt']` — CCXT не бандлится в клиентский код
- `__mocks__/server-only.ts` — заглушка для Jest (чтобы тесты не падали)

### Разделение API routes и клиента

- Все обращения к биржам — только через `/app/api/` routes (Next.js серверные функции)
- Клиент никогда не видит расшифрованные ключи
- `supabaseAdmin` (с secret key) используется только в серверных routes, никогда в компонентах
- Браузерный клиент Supabase использует только публичный `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

---

## 7. Биржевые адаптеры

Все адаптеры реализуют интерфейс `ExchangeAdapter` из `lib/adapters/types.ts`:
- `testConnection()` → `Promise<boolean>`
- `fetchBalance()` → `Promise<BalanceResult>`
- `getTrades(type, dateRange, since?, limit?, until?)` → `Promise<Trade[]>`
- `fetchPositions()` → `Promise<RawPosition[]>`

### Bybit (`lib/adapters/bybit.ts`)

Обходит **4 категории** параллельно через `Promise.allSettled`:
- `spot` — спотовые сделки
- `linear` — бессрочные фьючерсы в USDT
- `inverse` — обратные фьючерсы в монете
- `option` — опционы

Параметр `paginate: true` — CCXT автоматически делает постраничные запросы.
Ошибки по отдельным категориям молча игнорируются (не все аккаунты имеют все типы).
**Важно:** Bybit требует запросы из региона `fra1` (Европа) — иначе CloudFront блокирует.

### OKX (`lib/adapters/okx.ts`)

Обходит **5 instType** параллельно через `Promise.allSettled`:
- `SPOT`, `SWAP`, `FUTURES`, `OPTION`, `MARGIN`

Для passphrase использует поле `password` в CCXT конфиге.

### Binance (`lib/adapters/binance.ts`)

Поддерживает обычный режим и **Portfolio Margin** (флаг `portfolioMargin: true`).

**Portfolio Margin (PAPI):** использует `fetchIncome` для получения реализованного PnL. Запросы делаются **дневными окнами** (не более 7 дней за вызов), без фильтра по `incomeType`, чтобы не упустить позиции по редким символам.

**Обычный режим:** получаем список токенов из баланса, затем запрашиваем сделки по каждому известному символу через `fetchMyTrades`.

**Ограничение:** если монета была продана полностью — она уже не в балансе, и исторические сделки по ней не подтянутся.

### MEXC (`lib/adapters/mexc.ts`)

**Критически важно:** CCXT's `parsePosition` для MEXC оставляет большинство полей `undefined` в unified-объекте. Все реальные данные читаются из `p.info` (raw API response):

| Raw поле MEXC | CCXT unified | Описание |
|---|---|---|
| `info.realised` | `p.realizedPnl` (undefined!) | Чистый PnL (gross + fee) |
| `info.closeProfitLoss` | — | Gross PnL (движение цены) — используем это |
| `info.closeAvgPrice` | `p.lastPrice` (undefined!) | Цена закрытия |
| `info.openAvgPrice` | `p.entryPrice` | Цена открытия |
| `info.fee` | — | Комиссия (отрицательное число!) |
| `info.holdFee` | — | Funding cost |
| `info.closeVol` | `p.contracts` (= 0 для закрытых!) | Объём в контрактах |
| `info.createTime` | — | Время открытия позиции (ms) |
| `info.updateTime` | — | Время закрытия позиции (ms) |

**Fee semantics:** `info.realised = info.closeProfitLoss + info.fee` (fee отрицательный). В БД сохраняем `pnl = closeProfitLoss` (gross) и `fee = Math.abs(info.fee)`.

**Quantity:** `closeVol` × `contractSize` (из `this.swap.market(symbol).contractSize`). Нельзя использовать `p.contracts` — для закрытых позиций он равен 0.

**Full History Sync** — двухэтапный процесс:
1. `GET /api/sync/mexc/chunks` — возвращает `{ totalChunks: 1, chunkDays: 90 }` (MEXC хранит 90 дней)
2. `POST /api/sync/mexc/full` с `{ account_id, chunk_index }` — синхронизирует один 90-дневный чанк
3. `PATCH /api/sync/mexc/full` с `{ account_id, failed_count }` — записывает `last_full_sync_at`

**Пагинация:** `fetchPositionsHistory` с `page_num` (PAGE_SIZE=100 записей за страницу). Фильтрация по since/until — на стороне клиента (MEXC выдаёт ошибку 6003, если передать явный диапазон > 90 дней).

### Маппер сделок (`lib/adapters/ccxt-utils.ts`)

`mapCcxtTrade()` — общая функция для Bybit, OKX, Binance:
- Маппит поля CCXT-объекта сделки в внутренний тип `Trade`
- Извлекает PnL из `info.closedPnl` / `realised_pnl` / `pnl` (разные биржи, разные поля)
- Определяет `tradeType` (`spot`/`futures`) и `direction` (`long`/`short`)

MEXC использует отдельный маппер `mapMexcPositionHistory()` в `mexc.ts`.

---

## 8. Принципы разработки

### TDD (Test-Driven Development)

Все функции в `lib/calculations.ts` разрабатываются через тесты:
1. Написать тест в `lib/__tests__/calculations.test.ts` — убедиться, что он **падает**
2. Реализовать функцию — убедиться, что тест **проходит**
3. Рефакторинг при зелёных тестах

Запуск: `npx tsc --noEmit && npm test` (оба должны быть exit 0 перед коммитом).

### Git-дисциплина

- Коммит после каждого завершённого шага плана
- После каждого коммита — `git push origin main`
- Формат сообщения: `feat:`, `fix:`, `docs:`, `refactor:` + краткое описание

### Архитектурные правила

- **Бизнес-логика — в `lib/`**, компоненты только рендерят данные
- **Типы — в `lib/types.ts`**, не в компонентах inline
- **Новая страница** = `app/[name]/page.tsx` + одна запись в `lib/nav.ts`
- **Новый адаптер** = один файл в `lib/adapters/`

### Рабочий процесс с Claude

- Объяснить проблему и подход **до** написания кода
- Не писать код без явной команды
- Не делать изменений за пределами запрошенного scope
- Не добавлять комментарии, docstrings, error handling для несуществующих сценариев

---

## 9. Текущее состояние (production)

**Что работает:**
- Все 5 страниц задеплоены и доступны
- API Settings: создание/удаление аккаунтов, тест подключения к бирже — всё через реальные API
- Синхронизация: `POST /api/sync` получает балансы и сделки по всем аккаунтам (last 48h), сохраняет в Supabase
- Cron: автосинхронизация ежедневно в 09:00 UTC
- Bybit: сделки по 4 категориям; OKX: по 5 instTypes
- MEXC: Full History Sync (90 дней), реальный PnL, quantity в монетах (не контрактах), корректные openedAt/closedAt
- Binance PM: Portfolio Margin через PAPI, дневные окна запросов
- Шифрование API-ключей: AES-256-GCM, дешифровка только на сервере
- Header: кнопка "Sync Now" — показывает результат синхронизации
- History: PnL с 2 знаками после запятой, диапазон по умолчанию — последние 30 дней

**Что использует mock-данные:**
- Dashboard: метрики и график — из `mock-data.ts`
- Performance: эквити-кривые — из `mock-data.ts`
- History: таблица сделок — из `mock-data.ts`
- Results: графики и таблица — из `mock-data.ts`

---

## 10. План задач (следующие шаги)

### Block 3 — Dashboard
- Step 3.1: Заменить карточки по биржам на карточки по фондам (сгруппировать по fund name, показать AUM + PnL)
- Step 3.2: Подключить реальные данные — метрики из Supabase trades, график из Supabase balances

### Block 4 — Open Positions (страница Performance)
- Step 4.1: Создать `GET /api/positions` — real-time `fetchPositions()` через CCXT
- Step 4.2: Добавить секцию Open Positions под эквити-кривыми на странице Performance
  - Колонки: Symbol, Side, Size, Entry, Mark, Notional, Unrealized PnL, Leverage, Margin
  - Шапка: Total Unrealized PnL + Total Notional
  - Фильтр по аккаунту/бирже, цвет по знаку PnL, loading state

### Block 5 — Замена mock-данных
- Step 5.1: История (`/history`) — реальные сделки из Supabase
- Step 5.2: Результаты (`/results`) — реальные балансы и сделки из Supabase

### Ключевые решения (уже согласованы)
- Карточки дашборда группируются по Фонду (не по бирже)
- Total PnL и Fund badge убираются из шапки
- Тип аккаунта: `'unified'` как дефолт, необязательное поле
- Bybit: 4 категории (`spot`, `linear`, `inverse`, `option`)
- OKX: 5 instTypes (`SPOT`, `SWAP`, `FUTURES`, `OPTION`, `MARGIN`)
- Регион Vercel: `fra1` (Франкфурт) — обязателен для Bybit
- Cron: ежедневно в 09:00 UTC (ограничение Hobby плана)

---

## 11. Известные ограничения

| Ограничение | Детали |
|---|---|
| **Supabase Free план** | 500 МБ хранилища; проект автоматически засыпает после 7 дней неактивности; нужно просыпать вручную |
| **Vercel Hobby план** | Cron Jobs — не чаще 1 раза в день; функции работают только в одном регионе |
| **Binance trades** | API требует символ — нельзя получить все сделки сразу; пропускаются сделки по монетам, которых уже нет в балансе |
| **MEXC история** | API хранит максимум 90 дней истории позиций; Full Sync ограничен этим периодом |
| **MEXC CCXT маппинг** | `parsePosition` оставляет большинство полей `undefined`; все данные читаются из `p.info` (raw) |
| **Единый логин** | `admin` / `admin123` — общие credentials для всех пользователей; нет разделения по ролям |
| **Mock-данные** | Dashboard, Performance, History, Results пока работают на mock-данных |
| **Нет настоящей авторизации** | Auth через localStorage; в продакшене нужен JWT или NextAuth |
| **CCXT server-only** | CCXT нельзя использовать в клиентском коде; все запросы к биржам — только через API routes |

---

## 12. Как запустить локально

### Требования

- Node.js 20+
- npm 10+
- Аккаунт Supabase (с применёнными миграциями)
- API-ключи бирж (опционально, для реальных данных)

### Шаги

```bash
# 1. Клонировать репозиторий
git clone https://github.com/scamachine5252/crypto-dashboard.git
cd crypto-dashboard

# 2. Установить зависимости
npm install

# 3. Создать файл с переменными окружения
# создать .env.local вручную:
```

**Содержимое `.env.local`:**

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJ...
SUPABASE_SECRET_KEY=eyJ...
ENCRYPTION_KEY=<64 hex символа, 32 байта>
```

> Генерация ENCRYPTION_KEY: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

```bash
# 4. Применить миграции в Supabase
# Открыть Supabase Dashboard → SQL Editor → выполнить каждый файл из supabase/migrations/ по порядку (001–012)

# 5. Запустить dev-сервер
npm run dev
# → http://localhost:3000

# 6. Запустить тесты
npm test
# → должно быть 454 passing, 0 failing
```

### Вход в приложение

- URL: `http://localhost:3000`
- Логин: `admin`
- Пароль: `admin123`

### Добавить реальный аккаунт

1. Перейти в `/api-settings`
2. Заполнить форму: Fund / Exchange / Account Name / Instrument / API Key / API Secret / (PassPhrase для OKX)
3. Нажать CREATE ACCOUNT
4. Нажать Test — должно показать "Connected"
5. Нажать "Sync Now" в шапке — сделки и балансы загрузятся в Supabase

### Full History Sync для MEXC

После добавления MEXC аккаунта инкрементальный sync (`Sync Now`) захватит только последние 48 часов. Для полной истории:

1. Открыть `/api-settings`
2. Нажать "Full History" рядом с MEXC аккаунтом — запустит 1 чанк (90 дней)
3. После завершения в Supabase появятся все закрытые позиции за последние 90 дней
