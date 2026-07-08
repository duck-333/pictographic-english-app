# ADR-0001: 项目主线与目录边界

Status: Accepted

Date: 2026-07-08

## Context

The repository contains multiple historical and active projects. AI sessions and human collaborators can easily confuse the old demo, outer uni-app attempt, generated output, and current source code.

## Decision

The current project mainline is:

```text
miniapp-uni/word-app1              user WeChat mini program
admin-portal/pictographic-admin    independent admin portal
server                             Node API
content-seed                       seed/import content
scripts                            validation and audit tools
```

The following are not active business source for the current mini program:

```text
src
public
dist
outer miniapp-uni App/pages
unpackage directories
node_modules
```

Admin functionality must never be implemented as a hidden mini program page.

## Consequences

- Future tasks must state which project area they touch.
- AI agents must not modify historical/reference areas unless explicitly instructed.
- Generated build output is not a development target.
- This boundary reduces accidental changes but requires occasional documentation updates when real ownership changes.

