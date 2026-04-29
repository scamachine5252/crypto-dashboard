# Система управления рисками — Техническое задание

**Проект:** Cicada Foundation Dashboard  
**Версия:** 1.1  
**Дата:** 2026-04-28

---

## 1. Назначение

Система управления рисками обеспечивает мониторинг рисков в реальном времени для управляющих хедж-фондом. Система отслеживает открытые позиции по всем подключённым биржевым аккаунтам, сравнивает их с заданными порогами и:

- Отправляет **Telegram-оповещение** при превышении `alert_threshold`
- **Приостанавливает аккаунт** (`is_suspended = true`) при превышении `kill_threshold`
- Хранит **полную историю алертов** с возможностью подтверждения каждого из них ("Dismiss")

Система доступна по адресу `/risk-management` и работает со всеми поддерживаемыми биржами: Bybit, Binance, OKX, MEXC.

---

## 2. Схема базы данных

### `risk_rules` — пороги по аккаунтам

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | генерируется автоматически |
| `account_id` | uuid → `accounts.id` | CASCADE DELETE |
| `rule_type` | text | одно из 9 значений (см. §3) |
| `alert_threshold` | numeric | порог предупреждения |
| `kill_threshold` | numeric? | порог приостановки — `null` = нет kill |
| `enabled` | boolean | мягкое отключение без удаления записи |
| `created_at`, `updated_at` | timestamptz | — |

Уникальное ограничение: `(account_id, rule_type)` — одна запись на правило на аккаунт.

---

### `risk_alerts` — история нарушений и ошибок

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | uuid PK | — |
| `account_id` | uuid → `accounts.id` | — |
| `rule_type` | text | одно из 9 правил или `'evaluation_error'` при сбое биржи |
| `current_value` | numeric | значение метрики в момент срабатывания; `0` при ошибке оценки |
| `alert_threshold` | numeric | превышенный порог; `0` при ошибке оценки |
| `kill_threshold` | numeric? | kill-порог на момент срабатывания |
| `severity` | text | `'warning'` или `'critical'` |
| `acknowledged` | boolean | DEFAULT false |
| `fired_at` | timestamptz | DEFAULT now() |

**Специальное значение `rule_type`:** `'evaluation_error'` записывается, когда аккаунт не удалось проверить (биржа недоступна, ключи истекли, превышен rate limit и т.д.). Такие записи отображаются в секции Alerts вкладки Monitor наравне с обычными нарушениями правил и подчиняются той же логике дедупликации (не более 1 раза в день на аккаунт).

---

### `risk_metric_snapshots` — последние вычисленные значения метрик

| Колонка | Тип | Описание |
|---------|-----|----------|
| `account_id` | uuid PK | — |
| `rule_type` | text PK | — |
| `current_value` | numeric | последнее вычисленное значение |
| `evaluated_at` | timestamptz | — |

Обновляется после каждого цикла оценки. Обеспечивает быструю загрузку страницы Monitor без обращения к биржам.

---

### Дополнительные колонки таблицы `accounts`

| Колонка | Тип | По умолчанию | Описание |
|---------|-----|--------------|----------|
| `is_suspended` | boolean | `false` | Устанавливается в `true` при срабатывании kill switch. Sync пропускает приостановленные аккаунты. |
| `kill_switch_enabled` | boolean | `true` | Мастер-переключатель kill switch. При значении `false` аккаунт никогда не будет приостановлен, даже при превышении kill threshold. |

---

## 3. Типы правил

Поддерживается 9 типов правил:

| `rule_type` | Единица | Формула | Направление |
|---|---|---|---|
| `max_positions` | шт. | `positions.length` | чем выше — тем хуже |
| `position_size` | USD | `max(position.notional)` | чем выше — тем хуже |
| `max_drawdown` | % | `(peakAdjusted − currentAdjusted) / peakAdjusted × 100` | чем выше — тем хуже |
| `max_unrealized_pnl_per_position` | USD | `abs(min(position.unrealizedPnl))` при отрицательном значении | чем выше — тем хуже |
| `max_net_position_instrument` | USD | `max по символам abs(сумма_лонгов − сумма_шортов)` | чем выше — тем хуже |
| `max_net_position_account` | USD | `abs(все_лонги − все_шорты)` | чем выше — тем хуже |
| `leverage` | x | `sum(notional) / currentUsdtBalance` | чем выше — тем хуже |
| `margin_utilization` | % | `sum(margin) / currentUsdtBalance × 100` | чем выше — тем хуже |
| `min_liq_distance` | % | `min(abs(markPrice − liqPrice) / markPrice × 100)` | **чем ниже — тем хуже** |

### Коррекция просадки на депозиты и выводы

`max_drawdown` использует скорректированные балансы, чтобы не путать пополнения счёта с торговым ростом:

```
adjustedBalance(дата) = usdtBalance(дата) − накопленные_депозиты(≤дата) + накопленные_выводы(≤дата)
peakAdjustedBalance   = max(adjustedBalance) за всю историю
currentAdjustedBalance = текущийБаланс − всеДепозиты + всеВыводы
drawdown              = (peakAdjusted − currentAdjusted) / peakAdjusted × 100
```

---

## 4. API-маршруты

| Метод | Маршрут | Описание |
|-------|---------|----------|
| `GET` | `/api/risk/rules?account_id=` | Список правил, опционально с фильтром по аккаунту |
| `POST` | `/api/risk/rules` | Создать или обновить правило (upsert по `account_id + rule_type`) |
| `DELETE` | `/api/risk/rules/[id]` | Удалить правило |
| `GET` | `/api/risk/alerts?account_id=&acknowledged=` | Список алертов (макс. 200), сортировка по `fired_at` DESC |
| `PATCH` | `/api/risk/alerts/[id]/acknowledge` | Пометить алерт как прочитанный |
| `POST` | `/api/risk/evaluate` | Запустить полный цикл оценки рисков |
| `GET` | `/api/risk/live-metrics` | Живые позиции + все 9 метрик по всем аккаунтам (вызов биржи) |
| `GET` | `/api/risk/snapshots` | Последние сохранённые значения метрик из БД (без вызова биржи) |

---

## 5. Движок оценки рисков

Расположен в `lib/risk/run-evaluation.ts`. Вызывается из:
- `POST /api/risk/evaluate` (ручной Refresh в UI)
- `POST /api/sync` (автоматически после каждого цикла синхронизации)

### Алгоритм

```
Для каждого аккаунта где is_suspended = false:
  1. Загрузить enabled risk_rules из БД
  2. Расшифровать API-ключи и создать адаптер биржи
  3. Вызвать adapter.fetchPositions() → живые открытые позиции
  4. Загрузить latestBalance и allTimeHighBalance из таблицы balances
  5. Вычислить peakAdjustedBalance и currentAdjustedBalance (с учётом транзакций)
  6. computeAllMetricValues() → все 9 значений метрик
  7. Upsert в risk_metric_snapshots (одна строка на rule_type на аккаунт)
  8. evaluateRules() → список нарушений

  Для каждого нарушения:
    а. Проверить: есть ли уже непрочитанный алерт по этому правилу сегодня?
       → Если да — пропустить (дедупликация: максимум 1 алерт в день на правило)
    б. INSERT в risk_alerts
    в. Если severity = 'critical' И kill_threshold задан И kill_switch_enabled = true:
       → UPDATE accounts SET is_suspended = true
    г. Отправить Telegram-сообщение (ошибки логируются, не ломают цикл)

  Если аккаунт выбрасывает исключение (биржа недоступна, ключи истекли, rate limit):
    а. Захватить полный текст ошибки из исключения
    б. Проверить: есть ли уже непрочитанный алерт 'evaluation_error' сегодня для этого аккаунта?
       → Если да — пропустить (та же дедупликация)
    в. INSERT в risk_alerts с rule_type = 'evaluation_error', severity = 'warning'
    г. Отправить Telegram-сообщение с причиной ошибки (обрезается до 300 символов)
    д. Перейти к следующему аккаунту — один сбой не прерывает остальные

runRiskEvaluation() возвращает { evaluated, violations, errors },
где errors — количество аккаунтов, завершившихся с ошибкой за этот прогон.
```

---

## 6. Telegram-оповещения

Прямой HTTP-вызов к Telegram Bot API — без сторонних библиотек.

**Необходимые переменные окружения:**
- `TELEGRAM_BOT_TOKEN` — токен бота от @BotFather
- `TELEGRAM_CHAT_ID` — ID чата или группы для отправки сообщений

Если переменные не заданы — оповещения молча пропускаются (без ошибки).

### Формат: предупреждение
```
⚠️ RISK ALERT — Aniket (bybit)
Rule: Max Drawdown
Current: 1.80 | Alert: 1.50
2026-04-28 14:32 UTC
```

### Формат: критическое / Kill Switch
```
🔴 KILL SWITCH — Aniket (bybit)
Rule: Max Drawdown
Current: 2.10 | Kill: 2.00
Account SUSPENDED — revoke API key manually on exchange.
2026-04-28 14:32 UTC
```

### Формат: ошибка оценки
Отправляется, когда аккаунт не удаётся проверить (биржа недоступна, истекли ключи, rate limit и т.д.).

```
⚠️ EVALUATION ERROR — Aniket (bybit)
Risk check failed — account may be unmonitored.
`bybit {"retCode":10004,"retMsg":"error sign! origin_string..."}`
2026-04-28 14:32 UTC
```

Причина ошибки берётся напрямую из текста исключения и обрезается до 300 символов. Оформляется тегами `<code>` для HTML-режима Telegram. Дедупликация: не более 1 сообщения на аккаунт в день.

---

## 7. Интерфейс — страница `/risk-management`

Две вкладки: **Monitor** и **Settings**.

---

### Вкладка Monitor

#### Таблица метрик

По одной строке на аккаунт, 9 колонок с текущими значениями. Данные загружаются через `GET /api/risk/live-metrics` при каждом нажатии Refresh — живой вызов к бирже.

**Цветовая кодировка ячеек:**

| Цвет | Значение |
|------|----------|
| Зелёный | Значение в пределах нормы |
| Жёлтый `#FBBF24` | Превышен `alert_threshold` |
| Красный | Превышен `kill_threshold` |
| `—` | Правило не задано, нет данных или нет открытых позиций |

`min_liq_distance` — инвертированная логика: красный когда значение **ниже** порога (ближе к ликвидации = хуже).

#### Детализация позиций

Клик на ячейку метрики разворачивает встроенную таблицу с топ-5 позициями, наиболее релевантными для данной метрики:

| Метрика | Сортировка |
|---------|-----------|
| `max_positions`, `position_size`, `leverage` | по notional DESC |
| `max_unrealized_pnl_per_position` | по unrealizedPnl ASC (наибольшие убытки первыми) |
| `max_net_position_instrument` | по abs(чистая экспозиция символа) DESC |
| `max_net_position_account` | по знаковой чистой позиции DESC |
| `margin_utilization` | по margin DESC |
| `min_liq_distance` | по дистанции до ликвидации ASC (ближайшие первыми) |
| `max_drawdown` | позиции не показываются — метрика уровня баланса |

Колонки: Symbol, Side, Notional, Entry Price, Mark Price, Unrealized PnL, Liq Price, Liq Distance.

#### Кнопка Refresh

При нажатии выполняется три вызова:
1. `GET /api/risk/live-metrics` — получить живые позиции и вычислить метрики
2. `POST /api/risk/evaluate` — оценить правила, записать алерты в БД, отправить Telegram при срабатывании
3. `GET /api/risk/alerts?acknowledged=false` — обновить список алертов

#### Секция алертов

Список непрочитанных алертов под таблицей метрик. Кнопки фильтра: **Unread** | **Critical** | **All**.

Каждая строка алерта: badge severity, аккаунт + название правила, текущее значение vs порог, время, кнопка Dismiss.

---

### Вкладка Settings

#### Таблица порогов

По одной строке на аккаунт. Для каждого из 9 типов правил — два числовых поля: **Alert** и **Kill**.

- Пустое поле Alert = правило отключено (метрика не мониторится для этого аккаунта)
- Поле Kill необязательно — оставьте пустым для правил без kill switch

Две дополнительные колонки на каждый аккаунт:
- **Monitor ON/OFF** — включает или отключает все правила аккаунта (флаг `enabled` на всех записях)
- **Kill SW ON/OFF** — переключает `accounts.kill_switch_enabled`; включение требует подтверждения во встроенном диалоге, чтобы исключить случайное нажатие

#### Кнопка Save All

При сохранении для каждого аккаунта:
- Правила с заполненным Alert → `POST /api/risk/rules` (upsert)
- Правила с пустым Alert, имеющие запись в БД → `POST /api/risk/rules` с `enabled: false`
- `PATCH /api/accounts/[id]` → обновить `kill_switch_enabled`

---

## 8. Известные ограничения

| Область | Статус |
|---------|--------|
| Видимость сбоев оценки | **Реализовано** — ошибка захватывается, записывается в `risk_alerts` как `evaluation_error`, Telegram отправляется с полным текстом ошибки; дедупликация 1 раз в день на аккаунт |
| Дедупликация алертов | **Реализовано** — максимум 1 алерт на правило (или ошибку оценки) на аккаунт в день |
| Автоматический запуск оценки по расписанию | **Не реализовано** — evaluate запускается только при ручном Refresh или во время sync |
| Реальный отзыв API-ключей через биржу | **Не реализовано** — только `is_suspended = true` + ручная инструкция оператору |
| Пагинация алертов свыше 200 | **Не реализовано** — жёсткий лимит 200 записей |
| Снятие приостановки аккаунта через UI | **Не реализовано** — нет UI или API-маршрута для сброса `is_suspended` |
| Оповещение о восстановлении (нарушение устранено) | **Не реализовано** |
| Несколько получателей Telegram (разные чаты по фондам) | **Не реализовано** — единый глобальный `TELEGRAM_CHAT_ID` |

---

## 9. Карта файлов

| Файл | Назначение |
|------|-----------|
| `lib/risk/types.ts` | TypeScript-интерфейсы: `RiskRule`, `RiskAlert`, `RiskViolation`, `EvaluateInput` |
| `lib/risk/evaluate.ts` | Чистые функции: `computeAllMetricValues()`, `evaluateRules()` |
| `lib/risk/run-evaluation.ts` | Оркестрация: получение позиций, вычисление, запись в БД, Telegram |
| `lib/telegram.ts` | `sendTelegramAlert()`, `formatAlertMessage()`, `formatEvaluationErrorMessage()` |
| `app/api/risk/rules/route.ts` | `GET` / `POST` правила |
| `app/api/risk/rules/[id]/route.ts` | `DELETE` правило |
| `app/api/risk/alerts/route.ts` | `GET` алерты |
| `app/api/risk/alerts/[id]/acknowledge/route.ts` | `PATCH` подтверждение алерта |
| `app/api/risk/evaluate/route.ts` | `POST` запуск оценки |
| `app/api/risk/live-metrics/route.ts` | `GET` живые позиции + метрики |
| `app/api/risk/snapshots/route.ts` | `GET` последние сохранённые снапшоты метрик |
| `app/risk-management/page.tsx` | Полный UI — вкладки Monitor и Settings |
| `supabase/migrations/017_add_risk_rules.sql` | Создаёт таблицу `risk_rules` |
| `supabase/migrations/018_add_risk_alerts.sql` | Создаёт таблицу `risk_alerts` |
| `supabase/migrations/019_risk_monitor_snapshots.sql` | Создаёт `risk_metric_snapshots`, добавляет `kill_switch_enabled` |
| `supabase/migrations/020_extend_risk_rule_types.sql` | Расширяет CHECK constraint: добавляет `leverage`, `margin_utilization`, `min_liq_distance` |
