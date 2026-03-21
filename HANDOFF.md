# CICADA FOUNDATION — Документ для передачи разработки

> Последнее обновление: 2026-03-21

---

## 1. О проекте

**CICADA FOUNDATION** — внутренний дашборд для крипто-хедж-фонда. Отслеживает PnL, балансы и историю сделок по нескольким аккаунтам на биржах Binance, Bybit и OKX.

**Что умеет:**
- Показывать балансы и ключевые метрики (Sharpe, Sortino, MDD, Win Rate и др.) по всем аккаунтам
- Строить графики эквити-кривых с нормализацией к нулю
- Хранить историю сделок и синхронизировать их из бирж через CCXT
- Управлять API-ключами (хранятся в Supabase в зашифрованном виде AES-256-GCM)
- Два визуальных режима: Wintermute (тёмная тема) и Cicada (светлая)

**Текущий статус:** синхронизация сделок работает. Добавлен уникальный индекс для дедупликации. Bybit получает сделки по 4 категориям, OKX — по 5 instType. Следующий крупный блок — подключение реальных данных к дашборду.

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
| Jest + ts-jest | latest | Тесты (243 passing) |
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
- **Миграции:** 001–006 применены (007 — в плане)

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
│   ├── history/page.tsx        ← история сделок: фильтры + таблица + экспорт
│   ├── api-settings/page.tsx   ← управление аккаунтами и API-ключами
│   └── api/
│       ├── accounts/           ← GET, POST; [id] DELETE
│       ├── sync/               ← GET + POST: синхронизация всех аккаунтов
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
│   ├── utils.ts                ← formatMoney, formatPercent, formatDate, cn
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
│   │   └── ccxt-utils.ts       ← mapCcxtTrade() — общий маппер сделок
│   └── __tests__/
│       └── calculations.test.ts
│
└── supabase/migrations/        ← SQL-миграции 001–006
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
Биржа (Binance / Bybit / OKX)
    ↓ HTTPS (серверный API route)
CCXT (lib/adapters/bybit.ts и др.)
    ↓ mapCcxtTrade()
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
| `exchange` | text NOT NULL | `'binance'` / `'bybit'` / `'okx'` |
| `account_name` | text NOT NULL | Название аккаунта |
| `fund` | text | Название фонда |
| `instrument` | text | `'spot'` / `'futures'` / `'unified'` (nullable) |
| `api_key` | text NOT NULL | AES-256-GCM зашифрованный ключ |
| `api_secret` | text NOT NULL | AES-256-GCM зашифрованный секрет |
| `passphrase` | text | AES-256-GCM зашифрованный пароль (только OKX) |
| `account_id_memo` | text | Memo/ID аккаунта (опционально) |
| `is_testnet` | boolean | По умолчанию false |
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
| `exchange` | text NOT NULL | Биржа |
| `symbol` | text NOT NULL | Торговая пара |
| `side` | text NOT NULL | `'buy'` / `'sell'` |
| `trade_type` | text NOT NULL | `'spot'` / `'futures'` |
| `direction` | text | `'long'` / `'short'` / `'unknown'` (nullable) |
| `entry_price` | numeric | Цена входа |
| `exit_price` | numeric | Цена выхода |
| `quantity` | numeric | Объём |
| `pnl` | numeric | Реализованный PnL |
| `fee` | numeric | Комиссия |
| `opened_at` | timestamptz | Время открытия |
| `closed_at` | timestamptz | Время закрытия |
| `raw_data` | jsonb | Оригинальный ответ биржи |
| `created_at` | timestamptz | Дата записи |

**Уникальный индекс:** `(account_id, symbol, opened_at)` — для upsert без дублей.

### Миграции

| Файл | Что делает |
|---|---|
| `001_initial_schema.sql` | Создаёт таблицы `accounts`, `balances`, `trades`; включает RLS; политика `service_role full access` на все таблицы |
| `002_add_instrument_to_accounts.sql` | Добавляет колонку `instrument` (`'spot'`/`'futures'`) в `accounts` |
| `003_fix_column_names.sql` | Переименовывает `label→account_name`, `api_key_encrypted→api_key`, `api_secret_encrypted→api_secret`, `passphrase_encrypted→passphrase`; добавляет колонку `fund` |
| `004_add_account_id_memo.sql` | Добавляет nullable колонку `account_id_memo` в `accounts` |
| `005_add_direction_to_trades.sql` | Добавляет nullable колонку `direction` (`'long'`/`'short'`/`'unknown'`) в `trades` |
| `006_add_trades_unique_constraint.sql` | Уникальный индекс `(account_id, symbol, opened_at)` для дедупликации при upsert |
| `007_*` | В плане: добавить `'unified'` к instrument, обновить существующие записи |

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

- Все файлы `lib/adapters/bybit.ts`, `binance.ts`, `okx.ts` начинаются с `import 'server-only'`
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
- `getTrades(type, dateRange, since?, limit?)` → `Promise<Trade[]>`

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

**Ограничение:** Binance API `fetchMyTrades` требует указать конкретный символ.
**Текущий подход:** получаем список токенов из баланса, затем запрашиваем сделки по каждому известному символу.
**Проблема:** если монета была продана полностью — она уже не в балансе, и исторические сделки по ней не подтянутся. Это известное ограничение для экзотических пар.

### Маппер сделок (`lib/adapters/ccxt-utils.ts`)

`mapCcxtTrade()` — общая функция для всех адаптеров:
- Маппит поля CCXT-объекта сделки в внутренний тип `Trade`
- Извлекает PnL из `info.closedPnl` / `realised_pnl` / `pnl` (разные биржи, разные поля)
- Определяет `tradeType` (`spot`/`futures`) и `direction` (`long`/`short`)

---

## 8. Принципы разработки

### TDD (Test-Driven Development)

Все функции в `lib/calculations.ts` разрабатываются через тесты:
1. Написать тест в `lib/__tests__/calculations.test.ts` — убедиться, что он **падает**
2. Реализовать функцию — убедиться, что тест **проходит**
3. Рефакторинг при зелёных тестах

Запуск: `npm test` (должно быть 0 ошибок перед коммитом).

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
- Синхронизация: `POST /api/sync` получает балансы и сделки по всем аккаунтам, сохраняет в Supabase
- Cron: автосинхронизация ежедневно в 09:00 UTC
- Bybit: сделки по 4 категориям; OKX: по 5 instTypes
- Шифрование API-ключей: AES-256-GCM, дешифровка только на сервере
- Header: кнопка "Sync Now" — показывает результат синхронизации

**Что использует mock-данные:**
- Dashboard: метрики и график — из `mock-data.ts`
- Performance: эквити-кривые — из `mock-data.ts`
- History: таблица сделок — из `mock-data.ts`
- Results: графики и таблица — из `mock-data.ts`

---

## 10. План задач (следующие шаги)

### Block 1 — Unified Account
- Step 1.1: Migration 007 — добавить `'unified'` к instrument, сделать поле необязательным, обновить существующие записи
- Step 1.2: Обновить валидацию `POST /api/accounts` — принимать `'unified'` и null
- Step 1.3: Форма API Settings — добавить "Unified" как опцию по умолчанию
- Step 1.4: Обновить тесты

### Block 2 — Header cleanup
- Step 2.1: Убрать Total PnL и Fund badge из `Header.tsx` (на всех страницах)

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
- Существующие аккаунты: обновить на `'unified'` в миграции 007
- Сделки Binance: по символу из баланса (известное ограничение для экзотических пар)
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
| **Единый логин** | `admin` / `admin123` — общие credentials для всех пользователей; нет разделения по ролям |
| **Mock-данные** | Dashboard, Performance, History, Results пока работают на mock-данных (2025-01-01 — 2025-12-31) |
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
cp .env.example .env.local   # если есть пример
# или создать .env.local вручную:
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
# Открыть Supabase Dashboard → SQL Editor → выполнить каждый файл из supabase/migrations/ по порядку

# 5. Запустить dev-сервер
npm run dev
# → http://localhost:3000

# 6. Запустить тесты
npm test
# → должно быть 243 passing, 0 failing
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
