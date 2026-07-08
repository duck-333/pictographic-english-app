# ADR-0007: 数据库变更规范

Status: Accepted

Date: 2026-07-08

## Context

The project has entered real backend/user-account territory. Database changes can affect login, paid rights, customer support, and production data. Unrecorded schema changes would make future AI sessions and rollbacks unsafe.

## Decision

Any production database structure change requires:

1. Requirement statement.
2. Impact assessment.
3. ADR entry or ADR update.
4. Schema proposal.
5. Migration plan.
6. Rollback plan.
7. Backup verification.
8. Test plan.
9. Human confirmation before execution.

For user identity and quota tables, schema must preserve:

- `users.id` as primary business identity.
- External identities as binding tables.
- Quota logs as append-only audit history where possible.
- Unique/idempotency constraints for one-time grants and request retries.

## Consequences

- Slower than ad hoc database edits.
- Safer for production and future paid features.
- Gives future AI sessions recoverable context.
- Requires disciplined documentation after every schema change.

