# Project Overview v1

Date: 2026-07-08

## Product

`象形英语 / Pictographic English` is a WeChat mini program that turns the explanation value of the Pictographic English book and lessons into a mobile lookup and learning service.

The product is not just a dictionary. The core value is:

```text
search a word
-> see the basic meaning
-> understand the pictographic breakdown
-> watch or navigate to lesson explanation
-> keep learning records and future membership rights
```

## Current Repository Shape

This repository is a single workspace containing multiple related projects:

```text
pictographic-english-app/
  miniapp-uni/word-app1/              current WeChat mini program
  admin-portal/pictographic-admin/    current admin portal
  server/                             Node API
  content-seed/                       seed content and import JSON
  scripts/                            validation and project checks
  src/                                historical React/Vite demo
  public/                             historical demo assets
  dist/                               historical build output
```

The current mini program source is `miniapp-uni/word-app1`, not the outer `miniapp-uni` folder.

The admin portal is an independent backend/web project. It must not be exposed as a mini program page.

## Current Development Phase

The project has completed the fast MVP delivery stage for the first usable product path:

- Mini program word search.
- Word detail display.
- Pictographic explanation display.
- Pronunciation audio playback.
- VOD/video viewing path.
- Admin content management.
- Admin login.
- WeChat login first version.
- Basic MySQL user tables.

The project is now entering the long-term maintenance stage. Future feature work should follow:

```text
requirement analysis
-> architecture design
-> module development
-> module review
-> testing
-> documentation update
-> Git commit
```

This phase change does not rewrite the existing MVP code. It means future work should use module documentation, ADRs where needed, and explicit file boundaries before implementation.

## Current Mainline

Current implemented mainline:

```text
mini program
  -> search homepage
  -> word detail page
  -> mine page / local learning records
  -> WeChat identity login

admin portal
  -> admin login
  -> content workbench
  -> word editing
  -> publish/unpublish/archive flow
  -> homepage featured word config
  -> audio/video/illustration metadata

server
  -> public published word APIs
  -> admin write APIs
  -> WeChat login API
  -> MySQL users + wechat_user_bindings
```

## Completed Capabilities

Implemented as of the latest read-only audit:

- WeChat mini program MVP pages exist under `miniapp-uni/word-app1`.
- Public production API base is `https://baxiaota.com`.
- Public word APIs return `published` content only.
- Homepage featured word is server-managed.
- Admin portal supports content editing and publishing.
- Admin portal uses server-side admin username/password login with session token.
- Server supports:
  - `GET /api/health`
  - `GET /api/words`
  - `GET /api/words/:id`
  - `GET /api/homepage/featured-word`
  - `POST /api/admin/login`
  - `GET /api/admin/auth/check`
  - `POST /api/admin/words`
  - `GET/POST /api/admin/homepage-featured`
  - `POST /api/auth/wechat-login`
- WeChat login first version is complete:
  - `uni.login()`
  - `/api/auth/wechat-login`
  - WeChat `jscode2session`
  - `openid`
  - `users`
  - `wechat_user_bindings`
  - project token returned to mini program
- Manual VOD URL and video segment playback path exists.
- Audio pronunciation and illustration image fields exist.
- Validation scripts exist in `package.json`.

## Not Yet Implemented

The following are confirmed directions or likely next work, but not implemented in code as of this document:

- WeChat phone number quick login.
- `user_phone_bindings`.
- User quota account.
- User quota ledger/log.
- Backend user management pages.
- Admin quota adjustment.
- Cloud-synced learning records.
- Membership system.
- Orders/payment.
- Physical book activation.
- VOD/member permission enforcement.
- Share/referral rewards.

## Current Product Direction

The current product decision is moving from simple WeChat identity login to an entitlement account model:

```text
visitor
  -> homepage featured word
  -> basic meaning

phone quick login user
  -> stable account identity
  -> initial lookup quota
  -> pictographic explanation
  -> learning record sync

member user, later
  -> full video/course rights
  -> book/member/order entitlements
```

Phone number should be treated as a strong identity binding for rights and customer support, not as the primary user record. The primary identity remains `users.id`.

## Current Risks

- Some older docs still describe admin token login, while current code uses admin username/password login and JWT-style session token.
- `.env.example` may lag current admin login requirements.
- The mini program Mine page still says no phone number is collected, which is true for current code but will need revision before phone quick login.
- User quota and permissions are not yet modeled.
- `admin-portal/pictographic-admin/pages/index/index.vue` is large and should not absorb every future admin function without boundaries.
- Production `JWT_SECRET` must be explicitly configured.
- Client-side video clipping must not be used as paid-content protection.

## Recommended Next Product Block

Before coding phone login or quota:

1. Confirm the V1 rules and ADR set.
2. Design phone login API and database migration.
3. Design quota account and ledger schema.
4. Add backend user management scope.
5. Implement in small blocks with ADR and `DEVELOPMENT_LOG.md` updates.
