# ADR-0004: 手机号快捷登录作为权益入口

Status: Accepted

Date: 2026-07-08

## Context

The first WeChat login version creates a project user from `openid`, but the product direction requires stable user rights: lookup quota, future book/member rights, customer support lookup, and purchase association. The user clarified that login should directly bind phone number because logged-in users receive valuable lookup opportunities and unlocked content.

## Decision

Phone quick login is the intended next login model for entitlement-bearing accounts.

The product model is:

```text
visitor
  -> basic meaning and limited public content

phone quick login user
  -> user_id
  -> openid binding
  -> phone binding
  -> initial lookup quota
  -> pictographic explanation access

member user, later
  -> full video/course/member rights
```

The login button should be transparent about phone authorization, for example:

```text
手机号快捷登录
用于创建学习账号、领取查词次数、同步学习记录，并关联后续会员权益
```

## Consequences

- Phone login is justified because it gates rights, not just passive browsing.
- The current Mine page wording must be changed before phone login is launched.
- Implementation must use WeChat `getPhoneNumber` through a user-tapped button and server-side exchange.
- Phone must remain a binding on `user_id`, not the primary identity.

