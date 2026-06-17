# Agent Escalation Runbook

## L1 - Self-repair
- Retry with clearer constraints.
- Narrow scope to the smallest failing slice.
- Re-run relevant validation.

## L2 - Peer escalation
- Ask a reviewer/peer agent to inspect failure cause.
- Keep ownership on the same branch.

## L3 - Human intervention
- Escalate to maintainer when policy/security/risk boundaries are unclear.
- Record decision in issue or PR.

## L4 - Stop and rollback
- Stop autonomous changes when risk is unclear or quality gates fail repeatedly.
- Revert to last known good state and open follow-up issue with evidence.

## Mandatory checkpoint after each wave
- [ ] validation executed
- [ ] evidence linked
- [ ] commit scoped to the wave
- [ ] next wave plan adjusted

