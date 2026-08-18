# Plans

Implementation plans for `lysterfield` live here as markdown files, moving through four states, one per subdirectory: `backlog/`, `ready/`, `in-progress/`, `done/`.

## Lifecycle

- **backlog/** - rough ideas, unscoped. Not ready to work on.
- **ready/** - fully specced. Anyone (human or agent) could pick it up.
- **in-progress/** - actively being implemented. Updated as decisions are made.
- **done/** - shipped. Includes an accurate record of what was actually built.

Movement is one-directional in the normal case: `backlog → ready → in-progress → done`. Moving backwards is fine if scope changes or work is paused - just update `status` and `updated` accordingly.

## Naming

Plans use kebab-case filenames that describe the work: `add-oauth-login.md`, `refactor-queue-consumer.md`. Names stay stable across the lifecycle; only the directory changes.

## Frontmatter

Every plan starts with YAML frontmatter:

```yaml
---
title: Add OAuth login
status: Ready         # Backlog | Ready | In Progress | Complete
created: 2026-07-01
updated: 2026-07-17
---
```

`status` mirrors the directory. Keep `updated` current when you touch the file.

## Template

```markdown
---
title: <short title>
status: Ready
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <Title>

## Goal
One or two sentences on what this plan achieves and why.

## Context
Background, constraints, links to related plans, issues, or discussions.

## Approach
The intended implementation - detail should match the risk of the work. Enough that someone else could pick it up.

## Tasks
- [ ] High-level checklist of the work.

## Open questions
Anything unresolved. Resolve or delete these before moving to `ready/`.
```

## Working on a plan

1. Check `ready/` for an existing spec that matches the task before re-planning from scratch.
2. Move the file to `in-progress/` and set `status: In Progress`.
3. Keep the plan honest as you work. When a decision changes the approach, update the plan.

## Finishing a plan

1. Move the file to `done/`.
2. Set `status: Complete` and update `updated`.
3. Add `## Overview` and `## Architecture` sections describing what actually shipped, including deviations from the original approach and why.

- One `in-progress/` plan per stream of work is the norm.
- Don't delete plans from `done/` - they're the historical record.
