# Skill: test-plan v1

## Purpose
Generate minimal, sufficient, deterministic test plans tied to acceptance criteria.

## Inputs
- Issue acceptance criteria
- Affected components/interfaces
- Existing test inventory

## Output contract
Return JSON with keys:
- `summary`
- `evidence`
- `risk`
- `actions`

## Deterministic rules
1. Each acceptance criterion maps to at least one test case.
2. Include both positive and negative path tests.
3. Prefer existing test harnesses and patterns over new frameworks.
4. Mark missing observability as a testability gap.

## Token optimization
- Reuse existing test naming and fixtures.
- Emit concise Given/When/Then steps.
