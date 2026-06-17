# Contributing

## Execution model

1. One issue has one primary owner.
2. One branch has one implementation owner (local or delegated).
3. Review responsibilities stay separate from implementation.
4. For parallel work, split by file/module boundaries.

## One-file-one-agent rule

- Do not have multiple agents edit the same file in the same wave.
- Define ownership per file set before implementation starts.
- If overlap appears, stop and re-plan the wave split.

## Required quality gates

- Infra CI green
- Security workflow green
- Deployment evidence attached
- Human PR review complete

## PR expectations

Use the repository PR template and include evidence links for:
- validation/deployment runs,
- risk/rollback decisions,
- environment impact.

