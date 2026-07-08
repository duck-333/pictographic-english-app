# ADR-0002: 后台扩展原则

Status: Accepted

Date: 2026-07-08

## Context

The admin portal already contains a large content workbench. The next business phase needs user management, quota visibility, and rights management. Adding everything to the same page without boundaries would make the admin hard to maintain.

## Decision

The admin portal remains the single independent backend project, but new admin capabilities should be added as clear modules:

- Content management
- Homepage recommendation management
- User management
- Quota and rights management
- Future order/member/book activation management

The first user-management admin version should be minimal:

- User list
- User detail
- Phone masked display
- WeChat binding display
- Quota balance
- Quota ledger
- Admin quota adjustment with reason

Do not rebuild the admin portal from scratch unless the user explicitly approves a dedicated refactor task.

## Consequences

- Reuses the current admin login and API patterns.
- Avoids exposing admin features in the mini program.
- Avoids a large rewrite before MVP validation.
- Requires discipline to avoid continuously expanding one huge page.

