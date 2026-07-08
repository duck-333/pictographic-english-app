# ADR-0005: 查词次数扣减规则

Status: Accepted

Date: 2026-07-08

## Context

The product will grant lookup opportunities. The user clarified that each time a user enters a word to view full content, it should cost one lookup, even if the same word was viewed before.

## Decision

Lookup quota is charged by full detail view entry:

```text
enter full word detail once
  -> deduct 1 lookup
```

Rules:

- Visitor can see basic meaning only.
- Logged-in user can view full content if quota balance is sufficient.
- Re-entering the same word later deducts again.
- Repeated requests for the same entry operation must be idempotent and must not double deduct.
- Search suggestions and basic meaning preview should not deduct quota.

Recommended idempotency key shape:

```text
word_detail_view:{user_id}:{word_id}:{request_id}
```

## Consequences

- Simpler product model than permanent word unlock.
- Better aligns with selling lookup opportunities.
- Requires backend-side deduction, not frontend-only counting.
- Requires request idempotency to avoid charging twice on retries, refreshes, or network duplication.

