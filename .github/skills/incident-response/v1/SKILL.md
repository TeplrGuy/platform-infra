# Skill: incident-response v1

## Purpose
Drive deterministic triage and mitigation during production incidents.

## Inputs
- Incident symptoms and timeline
- Logs/metrics/traces
- Recent deploy or config changes

## Output contract
Return JSON with keys:
- `summary`
- `evidence`
- `risk`
- `actions`

## Deterministic rules
1. State current impact and affected users first.
2. Propose mitigation before root-cause exploration if impact is ongoing.
3. Include rollback criteria and verification checks.
4. Produce post-incident action items with owners.

## Token optimization
- Prioritize high-signal telemetry snippets.
- Compress noisy logs into counted error families.
