# Skill: pr-review v1

## Purpose
Produce deterministic, high-signal PR review output with explicit risk calls.

## Inputs
- PR title/body
- Diff summary and changed files
- CI status and failing checks
- Linked issues/specs

## Output contract
Return JSON with keys:
- `summary`: one-pass verdict
- `evidence`: line-anchored findings
- `risk`: risk classification with blast radius
- `actions`: exact fixes or follow-ups

## Deterministic rules
1. Only flag issues with concrete evidence.
2. Separate blockers from non-blockers.
3. Always map findings to issue acceptance criteria.
4. Enforce evidence-first closeout (tests, screenshots, logs).

## Token optimization
- Prioritize changed lines over unchanged context.
- Collapse repeated findings into one canonical issue.
- Limit non-blocking commentary to 5 items max.
