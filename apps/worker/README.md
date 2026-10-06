[English](README.md) | [Русский](README.ru.md)

# Background worker boundary

Reserved directory only: no `package.json`, entry point or job runner. `pnpm dev` does not launch a worker.
Redis is available in local compose but no queue is connected to it yet.

Planned responsibilities: catalog import/mapping, media validation/conversion, mail delivery,
payment-event retry/reconciliation and metric aggregation. Each job needs a validated payload,
idempotency, bounded retries/timeouts, dead-letter handling and observable status before activation.
Durable payments and entitlements remain in PostgreSQL.

The first executable worker must be added to workspace build/launch/CI together with its actual queue
and server configuration. Do not store provider credentials in job payloads or public logs.
See [project dependencies](../../docs/architecture/PROJECT_MAP.md),
[data model](../../docs/architecture/DATA_MODEL.md) and [roadmap](../../docs/architecture/WEB_STACK_PLAN.md).
