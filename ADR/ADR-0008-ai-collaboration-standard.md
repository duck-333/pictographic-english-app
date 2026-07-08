# ADR-0008: AI 协作开发规范

Status: Accepted

Date: 2026-07-08

## Context

The project is developed with AI assistance across multiple sessions. Without durable rules, future sessions may lose context, modify wrong directories, or implement too much at once.

## Decision

AI development must follow `PROJECT_RULES.md`.

Before development, AI must read:

```text
PROJECT_RULES.md
PROJECT_OVERVIEW.md
ARCHITECTURE.md
DEVELOPMENT_LOG.md
ADR/*
AGENTS.md
```

Development must follow:

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

AI must not:

- Modify code without confirmation during planning/review/documentation-only tasks.
- Change unrelated modules together.
- Delete existing features without confirmation.
- Bypass architecture review for identity, permission, quota, payment, membership, media, or database changes.

## Consequences

- Future sessions can restore project context from repository docs.
- Small confirmed blocks become the default development unit.
- Documentation updates become part of completion, not optional cleanup.
- Some tasks will take longer upfront but reduce rework.

