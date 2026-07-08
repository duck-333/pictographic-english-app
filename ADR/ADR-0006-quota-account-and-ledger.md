# ADR-0006: 额度账户与流水设计

Status: Accepted

Date: 2026-07-08

## Context

The business needs the backend to answer: how many lookups a user has, how many were used, where the quota came from, and why a change happened. A single counter is not enough for customer support or future book/member rights.

## Decision

Quota must be modeled as account plus ledger:

```text
user_quota_accounts
  user_id
  quota_type
  balance
  total_granted
  total_used
  updated_at

user_quota_logs
  user_id
  quota_type
  delta
  balance_before
  balance_after
  source_type
  source_key
  operator_id
  remark
  created_at
```

Initial quota type:

```text
word_search
```

Initial source types:

```text
register_bonus
word_detail_view
admin_adjust
```

Future source types:

```text
book_activation
membership
payment_order
share_reward
```

## Consequences

- Backend can show remaining count and full history.
- Customer support can explain every quota change.
- Register bonus can be made idempotent through `source_key`.
- Deduction must be transactional and backend-owned.
- Slightly more complex than a single counter, but avoids future rework.

