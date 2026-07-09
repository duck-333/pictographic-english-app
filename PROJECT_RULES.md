# Project Rules v1

Date: 2026-07-08

This file is the highest project-level development rulebook for the Pictographic English repository. It applies to AI agents, subagents, and human collaborators. When this file conflicts with older project notes, follow this file and update the older note after confirmation. Safety rules in `AGENTS.md` remain mandatory; when rules differ, follow the stricter rule.

This is a v1 rule set, not a perfect final architecture. Update it incrementally when major decisions are made, such as phone login, quota accounting, VOD permissions, membership, payment, or database migrations.

## Required Reading Before Development

Before any AI development task, read these files in order:

1. `PROJECT_RULES.md`
2. `PROJECT_OVERVIEW.md`
3. `ARCHITECTURE.md`
4. `DEVELOPMENT_LOG.md`
5. `ADR/*`
6. `AGENTS.md`
7. `docs/modules/*`

If the task touches a specific area, also read the relevant local docs before proposing changes:

- Mini program: `miniapp-uni/word-app1/README.md`
- Admin portal: `admin-portal/README.md`, `admin-portal/AdminRoadmap.md`, `admin-portal/AccessControl.md`, `admin-portal/DataFlow.md`
- Server API: `server/README.md`
- Content data: `BackendDataModel.md`, `content-seed/README.md`

## Required Development Flow

Every feature or architecture change must follow this sequence:

```text
需求分析
-> 影响评估
-> 方案设计
-> 架构评审
-> 实现
-> 测试
-> 文档更新
-> Git提交
-> 人工确认
```

Rules for this flow:

- Do not implement before the requested scope and file boundaries are clear.
- If the user asks for planning or review, do not modify code.
- If the task affects architecture, database, permissions, user identity, payment, membership, video access, or production safety, create or update an ADR before implementation.
- After implementation, update `DEVELOPMENT_LOG.md`.
- If architecture changed, update `ARCHITECTURE.md`.
- If a durable decision changed, add or update an ADR.
- Start an independent code review step after feature development. If a separate review agent is unavailable, the main agent must perform a review pass and document findings.
- Git commit is part of completion only when the user has requested or confirmed committing. Never commit unrelated work.

## Module Development Lifecycle

All new features must follow the module lifecycle below:

1. Requirement analysis.
2. Architecture impact assessment.
3. ADR design or ADR update when the task affects architecture, database, identity, permissions, quota, membership, payment, media access, or production safety.
4. Module design documentation update when module principles, boundaries, data flow, API contracts, or storage ownership change.
5. Single-module development.
6. Module review.
7. Test verification.
8. Relevant `IMPLEMENTATION.md` update.
9. `DEVELOPMENT_LOG.md` update.
10. Git commit after user confirmation.

Rules:

- Do not skip architecture impact assessment for any feature that touches user identity, permission, quota, entitlement, membership, payment, media access, database structure, or production deployment.
- Do not treat an ADR as implementation approval. Implementation still requires explicit user confirmation.
- Do not mark a module complete until code, tests, documentation, and review are all handled for the confirmed scope.
- If implementation reveals the ADR or module design is wrong, stop and revise the design before continuing.

## Single-Module Development Principle

Develop one module at a time.

Forbidden:

- Modifying multiple business modules in one development block without explicit approval.
- Generating large amounts of code in one pass.
- Moving to the next feature before verifying the current module.
- Expanding the scope because nearby code looks convenient to change.
- Refactoring unrelated code during feature implementation.

Module completion standard:

- The confirmed feature scope is complete.
- Relevant automated checks and required manual checks have passed or are explicitly documented as not run.
- Relevant module documentation is synchronized.
- Architecture remains consistent with accepted ADRs.
- `DEVELOPMENT_LOG.md` is updated.
- Git commit is created only after the user confirms committing.

## AI Development Rules

Before any AI development task, AI must read:

```text
PROJECT_RULES.md
PROJECT_OVERVIEW.md
ARCHITECTURE.md
DEVELOPMENT_LOG.md
ADR/*
docs/modules/*
AGENTS.md
```

AI must not:

- Modify code before reading the required project documents.
- Modify architecture without creating or updating an ADR.
- Delete historical design records.
- Perform broad refactors without explicit approval.
- Develop multiple modules at the same time without explicit approval.
- Treat generated build output as source code.
- Continue coding when documents and code conflict, unless the user explicitly asks to resolve that conflict.

## Module Review Mechanism

Every module development block must be reviewed after implementation and before the work is considered complete.

Code review must check:

- Whether duplicate logic was introduced.
- Whether dead code was introduced.
- Whether existing behavior or public API behavior was broken.
- Whether the change stays inside the confirmed module boundary.

Architecture review must check:

- Whether the implementation follows accepted ADRs.
- Whether module boundaries remain clear.
- Whether other modules are affected unexpectedly.
- Whether database, API, entitlement, or content access assumptions changed.

Security review must check:

- Authentication and authorization.
- Sensitive data exposure.
- Input validation.
- Server-side enforcement for permission, quota, entitlement, and media access.
- Secret handling.

Documentation review must check:

- Relevant `IMPLEMENTATION.md` files are updated.
- `DEVELOPMENT_LOG.md` is updated.
- `ARCHITECTURE.md` is updated when module boundaries, data flow, APIs, or infrastructure changed.
- ADRs are added or updated when durable architecture decisions changed.

## Hard Prohibitions

Do not:

- Modify code before user confirmation when the current task is analysis, planning, review, or documentation-only.
- Modify multiple unrelated modules in one task.
- Delete existing features without explicit confirmation.
- Bypass architecture design for changes that affect identity, permissions, data model, quota, membership, payment, media access, or production deployment.
- Modify production database structures without an ADR and migration/rollback plan.
- Store secrets in frontend code, repository files, screenshots, or documentation examples.
- Put admin/content-management pages into the user mini program.
- Add new dependencies without explaining the problem solved, alternatives, package size/maintenance risk, and mini program review/performance impact.
- Mix the root React/Vite demo with the current mini program implementation unless explicitly requested.
- Treat generated build output as source code.

## Deletion Safety

Bulk deletion is forbidden.

Do not use:

- `del /s`
- `rd /s`
- `rmdir /s`
- `Remove-Item -Recurse`
- `rm -rf`

When deleting is explicitly approved, delete only one exact file path at a time. If multiple files or directories appear to need deletion, stop and ask the user to handle or explicitly confirm the cleanup plan.

## Source Boundaries

Current source-of-truth areas:

- Mini program: `miniapp-uni/word-app1`
- Admin portal: `admin-portal/pictographic-admin`
- Server API: `server`
- Content seed and validation: `content-seed`, `scripts`
- Long-term project docs: root `.md` files and `ADR`

Historical/reference areas:

- `src`: early React/Vite demo and UI reference.
- Outer `miniapp-uni`: old uni-app attempt, not the current mini program source.
- `dist`: historical build output.

Do not edit these unless the task explicitly targets them:

- `.git`
- `node_modules`
- `dist`
- `miniapp-uni/word-app1/unpackage`
- `admin-portal/pictographic-admin/unpackage`
- HBuilderX or WeChat Developer Tools generated output

## Architecture Rules

- `user_id` is the project-owned core user identity.
- `openid`, `unionid`, and phone number are external identity bindings, not primary users.
- Admin portal must remain an independent backend/web project, not a hidden user mini program page.
- Mini program public APIs must return only `published` content.
- Draft, unpublished, archived, review, pending, or missing-status content must not leak to the mini program.
- Quota and permission are different concepts:
  - Quota answers "how many times can the user use this?"
  - Permission answers "can the user access this feature/content?"
- Production database changes require ADR, migration plan, rollback plan, and backup verification.
- Media URLs used in production must be legal HTTPS/cloud URLs and configured in WeChat legal domains.
- Client-side video clipping is not a payment or membership security boundary.

## Documentation Rules

Every completed development block must update:

- `DEVELOPMENT_LOG.md`

Also update:

- `ARCHITECTURE.md` if module boundaries, data flow, APIs, or infrastructure changed.
- `ADR/*` if a durable architectural decision was made or changed.
- `PROJECT_OVERVIEW.md` if product status or completed capabilities changed.
- Existing local docs if they become materially stale.

Documentation must separate:

- Implemented facts
- Confirmed design direction
- Proposed future work
- Risks and unknowns

## Testing Rules

At minimum, run the checks relevant to the touched area.

Common checks:

```text
npm.cmd run validate:content
npm.cmd run check:miniapp
npm.cmd run check:admin
npm.cmd run check:server
npm.cmd run check:production
npm.cmd run check
```

For the mini program, automated checks are not enough. HBuilderX and WeChat Developer Tools manual validation remains required for user-facing flows.

For server/database changes, verify:

- API success path
- API failure path
- authentication/authorization failure
- idempotency where applicable
- migration rollback plan where applicable

## AI Collaboration Rules

- The main agent owns scope, task splitting, integration, verification, and final reporting.
- Subagents must receive explicit file boundaries and must not refactor outside their assigned scope.
- Review agents default to read-only.
- Long tasks should be split into small blocks.
- After 3-5 substantial blocks, update documentation and consider starting a fresh context.
- If documents and code disagree, stop and report the discrepancy before coding unless the user explicitly asks to resolve it.
