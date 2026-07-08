# ADR-0003: user_id 作为核心身份

Status: Accepted

Date: 2026-07-08

## Context

The project currently has WeChat login through openid and plans to add phone number binding, membership, book activation, learning records, and customer support lookup. If phone or openid becomes the primary identity, later account merging and rights management become fragile.

## Decision

`users.id` is the core internal identity.

External identity data must be stored as bindings:

```text
users.id
  -> wechat_user_bindings.openid / unionid
  -> user_phone_bindings.phone_hash / phone_masked
  -> future external identities
```

Business data must reference `users.id`, not directly reference `openid` or phone number.

## Consequences

- Supports future phone binding, WeChat binding, membership, orders, and learning records.
- Reduces account split risk.
- Requires explicit conflict handling when phone/openid bindings point to different users.
- Requires backend APIs to consistently return project-owned user identity, not raw WeChat identity.

