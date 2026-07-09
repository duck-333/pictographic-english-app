# Modules Knowledge Base

This directory is the module-level knowledge base for the current project.

The project has moved from a fast MVP delivery phase into a long-term maintenance phase. Earlier MVP work prioritized getting the core product path running. Future work should prioritize module boundaries, architecture review, testability, and durable documentation before adding more features.

## Current Implemented Modules

| Module | Principle | Implementation |
| --- | --- | --- |
| Word content | `word-content/PRINCIPLE.md` | `word-content/IMPLEMENTATION.md` |
| User auth | `user-auth/PRINCIPLE.md` | `user-auth/IMPLEMENTATION.md` |
| Video/VOD | `video-vod/PRINCIPLE.md` | `video-vod/IMPLEMENTATION.md` |
| Admin portal | `admin-portal/PRINCIPLE.md` | `admin-portal/IMPLEMENTATION.md` |
| Data storage | `data-storage/PRINCIPLE.md` | `data-storage/IMPLEMENTATION.md` |

## Required Future Development Flow

All new features should follow this sequence:

```text
Requirement analysis
-> Architecture design
-> Module development
-> Module review
-> Testing
-> Documentation update
-> Git commit
```

Rules for future work:

- Do not start coding before the target module and file boundaries are clear.
- If a feature crosses modules, document the data flow and ownership boundary first.
- If a feature changes identity, permissions, quota, payment, membership, media access, database structure, or production safety, update or create an ADR before implementation.
- Update the relevant `PRINCIPLE.md` only when business rules or design principles change.
- Update the relevant `IMPLEMENTATION.md` when files, APIs, core functions, storage, or data flows change.
- Keep `ARCHITECTURE.md` as the system-level map, not a replacement for module docs.
- Record every completed development block in `DEVELOPMENT_LOG.md`.

## Current Knowledge Boundaries

These documents describe current implementation facts. They are not permission to refactor existing code.

Known future work such as phone quick login, quota, membership, payments, cloud learning records, real VOD permission enforcement, and backend user management remains unimplemented unless code and database changes are explicitly made in a later confirmed task.

