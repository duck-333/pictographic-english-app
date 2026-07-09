# Database Change Plan

Date: 2026-07-09

This document is a database change design plan only. It is not an executed migration, not a migration script, and not approval to change any production database.

Before any database execution, follow `ADR/ADR-0007-database-change-standard.md`: confirm requirements, impact, schema, migration, rollback, backup, and test plan with a human operator.

## Scope

Planned next-phase database design for:

- `user_phone_bindings`
- `user_quota_accounts`
- `user_quota_logs`
- Future-reserved `user_entitlements`

Existing implemented tables remain:

- `users`
- `wechat_user_bindings`

All business data must reference `users.id`.

## Schema Design

### user_phone_bindings

Purpose: store phone identity binding for `users.id`.

```text
id
user_id
phone_hash
phone_masked
hash_version
country_code
status
bound_at
unbound_at
verified_at
last_verified_at
created_at
updated_at
```

Field rules:

- `phone_hash`: `HMAC-SHA256(normalized_phone, server_secret)`.
- `phone_masked`: display value only, such as `138****8000`.
- `hash_version`: first version can be `v1`; required for future key rotation.
- `status`: first version uses `active`; future lifecycle may use `unbound`.
- `bound_at`: when the phone binding first becomes active.
- `unbound_at`: only set by a future confirmed unbind flow.
- `verified_at`: first successful WeChat phone verification time.
- `last_verified_at`: latest successful WeChat phone verification time.

### user_quota_accounts

Purpose: current balance per user and quota type.

```text
id
user_id
quota_type
balance
total_granted
total_used
created_at
updated_at
```

Initial quota type:

```text
word_lookup
```

### user_quota_logs

Purpose: append-only audit ledger for all quota changes.

```text
id
user_id
quota_type
delta
balance_before
balance_after
source_type
source_key
request_id
idempotency_key
related_word_id
operator_id
remark
metadata_json
created_at
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
campaign_bonus
share_reward
```

Rules:

- `quota_type` identifies the balance being changed.
- `source_type` identifies the reason for the change.
- `balance_before` and `balance_after` are required for support and audit.
- `request_id` and `idempotency_key` are required for retry-safe deductions.
- `related_word_id` is required for `word_detail_view` deductions.
- `operator_id` and `remark` are required for admin adjustments.

### user_entitlements

Purpose: future qualification-based rights such as membership, video access, course package, or book entitlement. This table is reserved and should not be implemented until the entitlement feature is explicitly approved.

```text
id
user_id
entitlement_key
status
starts_at
expires_at
source_type
source_id
created_at
updated_at
```

## Index Design

Recommended indexes:

```text
user_phone_bindings.user_id
user_phone_bindings.phone_hash
user_phone_bindings.status

user_quota_accounts.user_id
user_quota_accounts.user_id + quota_type

user_quota_logs.user_id + created_at
user_quota_logs.user_id + quota_type + created_at
user_quota_logs.idempotency_key
user_quota_logs.request_id
user_quota_logs.related_word_id

user_entitlements.user_id
user_entitlements.user_id + entitlement_key + status
user_entitlements.expires_at
```

## Unique Constraints

Recommended unique constraints:

```text
user_phone_bindings.phone_hash
user_quota_accounts.user_id + quota_type
user_quota_logs.idempotency_key
```

Notes:

- `user_phone_bindings.phone_hash` is unique in the MVP to prevent one phone number from owning multiple active user identities.
- If future unbind/rebind needs historical multiple rows, add a new ADR and revise this unique constraint.
- `user_quota_logs.idempotency_key` prevents duplicate grants or duplicate deductions.

## Migration Strategy

This is a design plan only. The actual migration script must be created in a later confirmed implementation task.

Recommended migration order:

1. Verify production backup is complete and restorable.
2. Add `user_phone_bindings`.
3. Add `user_quota_accounts`.
4. Add `user_quota_logs`.
5. Do not add `user_entitlements` until entitlement implementation is approved.
6. Deploy server code that can use the new tables.
7. Verify new login and quota flows against staging or development database first.

Data backfill:

- Existing WeChat-only users remain valid.
- No phone binding backfill is possible until a user authorizes phone quick login.
- Register bonus should be granted only after identity is resolved and must be idempotent.

## Rollback Strategy

Rollback must be planned before production execution.

Recommended rollback approach:

1. Stop the new phone login/quota feature path.
2. Revert application code to the previous WeChat login-only path.
3. Keep newly created tables for audit unless a human confirms they can be removed.
4. If schema rollback is required, export affected table data first.
5. Do not delete production tables without explicit human confirmation.

## Backup Requirement

Before production execution:

- Confirm a full database backup exists.
- Confirm backup timestamp.
- Confirm restore procedure is known.
- Confirm the operator responsible for rollback.
- Confirm the target environment and database name.

## Test Cases

Identity tests:

- New user with no WeChat binding and no phone binding creates one `users.id`.
- Existing WeChat-only user binds phone to the same `users.id`.
- Existing phone-bound user binds WeChat to the same `users.id`.
- WeChat binding and phone binding pointing to different users returns `identity_conflict`.
- Repeated login request does not create duplicate users.

Phone privacy tests:

- API responses do not return phone plaintext.
- Admin query by phone uses HMAC lookup.
- Logs do not print phone plaintext.
- `phone_masked` is the only display value.

Quota tests:

- Register bonus is granted once.
- `word_lookup` account is created once per user.
- Word detail view deducts once.
- Duplicate `request_id` / `idempotency_key` does not double deduct.
- `balance_before` and `balance_after` are correct.
- Insufficient balance does not return full detail and does not create a misleading deduction.

Admin tests:

- Admin user list requires admin session.
- Admin user detail requires admin session.
- Quota logs are ordered and filterable by user.
- Phone fields in admin responses are masked.
