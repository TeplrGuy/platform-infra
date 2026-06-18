# Skill: contract-impact v1

## Purpose
Detect downstream and upstream break risk from API/schema changes.

## Inputs
- Proposed contract diff
- Known consumers/providers
- Versioning/backward-compatibility policy

## Output contract
Return JSON with keys:
- `summary`
- `evidence`
- `risk`
- `actions`

## Deterministic rules
1. Classify each change as additive, compatible, or breaking.
2. Enumerate impacted repositories and issue links.
3. Require migration path for breaking changes.
4. Block merge if no rollout/rollback plan exists.

## Token optimization
- Summarize contract diff as field-level table.
- Avoid whole-file replay; include only changed signatures.
