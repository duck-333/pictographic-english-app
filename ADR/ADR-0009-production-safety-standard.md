# ADR-0009: 生产安全规范

Status: Accepted

Date: 2026-07-08

## Context

The project now has production HTTPS API usage, admin login, WeChat login, MySQL user data, and media playback. Production mistakes can expose drafts, secrets, user data, or paid content.

## Decision

Production safety rules:

- No secrets in frontend code or repository.
- Production must configure private `JWT_SECRET`.
- Production must configure WeChat app secret only on the server.
- Production must configure database credentials only on the server.
- Public content APIs must filter `status === "published"` server-side.
- Admin APIs must require authenticated admin session.
- Phone numbers must be protected with masked display and non-reversible lookup hash at minimum.
- Database changes require ADR and backup/rollback plan.
- Production media URLs must be valid HTTPS/cloud URLs and legal in WeChat domain settings.
- Client-side video clipping is not access control.
- Local/mock/example URLs must not enter production content paths.

## Consequences

- Development-only shortcuts must be clearly labeled and blocked from production.
- Release readiness checks must remain part of the workflow.
- Future paid/member content requires server-side entitlement enforcement or signed/segmented media delivery.
- User privacy and production stability take priority over quick demos.

