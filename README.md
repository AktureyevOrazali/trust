# РНП: аналитика продаж, учеников и групп

Публичный Next.js-дэшборд центра китайского языка. Продажи собираются из amoCRM, ученики и группы - из AlphaCRM. Текущие данные и исторические срезы хранятся только в Netlify Postgres.

Production: [trust-alpha-dashboard.netlify.app](https://trust-alpha-dashboard.netlify.app)

## Правила данных

- AlphaCRM является единственным production-источником учеников, групп, занятий, тарифов и оплат.
- Google Sheets используется только как зафиксированный контракт формул и обезличенный тестовый набор. Приложение не читает таблицу в runtime.
- Формулы продления, оттока, срока обучения, LTV и экономики групп повторяют текущие формулы таблицы без исправлений.
- API дэшборда не возвращают телефон, email, адрес, дату рождения и заметки клиента.
- Неудачная синхронизация не удаляет последний успешный набор записей. После 36 часов сохранённые данные отмечаются как устаревшие.

## Требования

- Node.js `>=22.13.0`
- Netlify CLI через `npx netlify-cli`
- привязанный Netlify site с включённой Netlify Database

## Локальный запуск

```powershell
npm install
Copy-Item .env.example .env.local
npx netlify-cli dev
```

`netlify dev` запускает локальную Postgres-базу и Netlify Functions. Если `NETLIFY_DB_URL` уже задан вручную, интерфейс можно запустить командой `npm run dev`.

Проверки:

```powershell
npm test
npm run lint
npm run build
```

## Переменные окружения

Все значения задаются в Netlify для Functions и Runtime. Секреты нельзя помещать в git, логи или клиентский код.

| Переменная | Обязательность | Назначение |
| --- | --- | --- |
| `NETLIFY_DB_URL` | автоматически | строка подключения Netlify Database |
| `URL` | автоматически | публичный origin сайта для фоновых вызовов |
| `SYNC_SECRET` | обязательно | длинный случайный секрет ручной синхронизации |
| `AMO_BASE_URL` | обязательно для продаж | URL аккаунта amoCRM |
| `AMO_ACCESS_TOKEN` | обязательно для продаж | серверный токен amoCRM |
| `ALFA_BASE_URL` | обязательно | URL tenant AlphaCRM / s20.online |
| `ALFA_EMAIL` | обязательно | email API-пользователя AlphaCRM |
| `ALFA_API_KEY` | обязательно | API-ключ AlphaCRM |
| `ALFA_BRANCH_IDS` | опционально | ID филиалов через запятую; без значения филиалы обнаруживаются автоматически |

## Postgres и миграции

Схема находится в `db/schema.ts`, а версионируемый SQL - в `netlify/database/migrations/`. Netlify автоматически применяет эти миграции перед публикацией production и deploy preview. Ошибка миграции блокирует публикацию.

Локальная проверка состояния и применение ожидающих миграций:

```powershell
npx netlify-cli database status
npx netlify-cli database migrations apply
```

Не изменяйте содержимое уже применённой миграции. Для следующего изменения схемы создавайте новый файл.

## Синхронизация CRM

Опубликованный production-сайт запускает `crm-sync-scheduled` каждый час. Scheduled function ставит длительную работу в `crm-sync-background`; Postgres advisory lock не допускает пересечения запусков.

Ручной запуск всех источников:

```powershell
$headers = @{ Authorization = "Bearer $env:SYNC_SECRET" }
Invoke-RestMethod -Method Post -Headers $headers -Uri "$env:URL/api/integrations/sync?source=all"
```

Допустимые значения `source`: `amo`, `alfa`, `all`. Успешный запрос возвращает HTTP 202. Состояние запусков доступно через защищённый endpoint:

```powershell
Invoke-RestMethod -Headers $headers -Uri "$env:URL/api/integrations/summary"
```

Статусы `completed_with_errors` и `failed` нужно сверять с Netlify Function logs. Предыдущие записи остаются доступны, а интерфейс показывает их freshness.

## Однократный перенос месячных планов

Импортёр принимает JSON из stdin, сначала валидирует весь набор и только затем выполняет одну Postgres-транзакцию. Поддерживаются массив строк, `{ "results": [...] }` и стандартный массив result-envelope из CLI.

Пустой набор безопасен и оставляет встроенный `INITIAL_PLAN` источником плана:

```powershell
'[]' | node scripts/import-monthly-plans.mjs
```

Для однократного переноса архивных планов из прежней D1-базы:

```powershell
npx wrangler@4.92.0 d1 execute rnp-dashboard --remote --command "SELECT month,new_leads,no_contact_percent,contact_percent,revenue,new_sales,repeat_revenue,updated_at FROM monthly_plans ORDER BY month" --json | node scripts/import-monthly-plans.mjs
```

`NETLIFY_DB_URL` должен указывать на целевую Postgres-базу. Невалидная строка или ошибка записи откатывает всю транзакцию.

## Деплой

```powershell
npx netlify-cli status
npx netlify-cli deploy --build
npx netlify-cli deploy --build --prod
```

Перед production-публикацией проверьте environment variables, успешное применение миграций, `/api/integrations/summary`, вкладки «Продажи», «Ученики» и «Группы» на desktop и mobile.

## Откат

Старый удалённый Cloudflare deployment и исходная D1-база не изменяются этим проектом и временно остаются только как аварийная точка отката. В текущем repository нет Cloudflare runtime, D1 binding или команд Cloudflare deployment. Возврат трафика выполняется на уровне DNS/hosting после проверки сохранности старого deployment; данные из Postgres обратно автоматически не переносятся.

## Официальная документация

- [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/)
- [Netlify Database migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/)
- [Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/)
- [AlphaCRM API](https://alfacrm.pro/knowledge/integration/api)
