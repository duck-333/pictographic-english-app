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
- Phone quick login code path.
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

## Module Status

Current completed module:

```text
Module 1: 用户身份体系升级 - Completed
  -> Module 1.1 identity-store
  -> Module 1.2 wechat-phone-login API
  -> Module 1.3.1 mini program auth client/store
  -> Module 1.3.2 Mine page phone authorization entry
  -> Module 1 closing safety fix for phone-login error responses
```

Completion here means the repository code, documentation, production database migration, and production phone login validation are complete for the confirmed Module 1 scope.

## Current Mainline

Current implemented mainline:

```text
mini program
  -> search homepage
  -> word detail page
  -> mine page / local learning records
  -> WeChat identity login
  -> phone quick login

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
  -> WeChat phone login API
  -> MySQL users + wechat_user_bindings
  -> MySQL user_phone_bindings
```

## Completed Capabilities

Implemented as of Module 1 finalization:

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
  - `POST /api/auth/wechat-phone-login`
- WeChat login first version is complete:
  - `uni.login()`
  - `/api/auth/wechat-login`
  - WeChat `jscode2session`
  - `openid`
  - `users`
  - `wechat_user_bindings`
  - project token returned to mini program
- Phone quick login Module 1 code path is complete:
  - `server/identity-store.mjs` owns identity data access, phone hash/mask, and binding conflict rules.
  - Mine page uses `button open-type="getPhoneNumber"`.
  - Mini program auth client/store supports phone quick login and safe session storage.
  - Mini program calls `/api/auth/wechat-phone-login`.
  - Server exchanges WeChat login code and phone code.
  - Server binds WeChat identity and phone identity to `users.id`.
  - Phone numbers are stored as HMAC-SHA256 hash plus masked display value.
  - Phone login error responses are mapped to safe public codes and do not return MySQL raw error codes.
  - Production MySQL has executed `database/migrations/001_create_user_phone_bindings.sql`.
  - Production `user_phone_bindings` has verified test data with `user_id=1`, `phone_masked=195****0953`, and `status=active`.
  - Production before/after database backups were saved under `~/backups/`.
- Manual VOD URL and video segment playback path exists.
- Audio pronunciation and illustration image fields exist.
- Validation scripts exist in `package.json`.

## Not Yet Implemented

The following are confirmed directions or likely next work, but not implemented in code as of this document:

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
- Future staging or production-like databases still need their own reviewed `user_phone_bindings` migration execution and backup verification under ADR-0007.
- `npm.cmd run check:server` still has an independent legacy word API guard failure: `remote empty search results must not silently fall back to bundled words`.
- User quota and permissions are not yet modeled.
- `admin-portal/pictographic-admin/pages/index/index.vue` is large and should not absorb every future admin function without boundaries.
- Production `JWT_SECRET` must be explicitly configured.
- Client-side video clipping must not be used as paid-content protection.

## Recommended Next Product Block

Before coding Module 2 quota:

1. Confirm Module 1 production validation documentation.
2. Keep production database backups outside Git.
3. Design quota account and ledger implementation from ADR-0012.
4. Add backend user management scope only after quota data exists.
5. Implement in small blocks with ADR and `DEVELOPMENT_LOG.md` updates.
