# Deterministic Testing Instructions (Infrastructure)

## Core rule
Infrastructure PRs must provide deterministic validation evidence:
1. IaC build/lint validation
2. What-if/diff evidence for material changes
3. Environment promotion checks for high-risk updates

## Cost governance
- Keep full load/perf exercises manual and milestone-based.
- Run targeted smoke checks per PR; defer expensive scenario tests to scheduled checkpoints.

## Required PR evidence
- `az bicep build` / validation output
- What-if summary (for resource-impacting changes)
- Rollback readiness note for high-risk changes