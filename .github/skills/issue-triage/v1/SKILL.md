# Skill: issue-triage v1

## Purpose
Convert a raw issue into an execution-ready work item with deterministic scope.

## Inputs
- Issue title/body
- Labels
- Related issue/PR links
- Repo constraints (`copilot-instructions.md`, standards)

## Output contract
Return JSON with keys:
- `summary`: one-paragraph problem framing
- `evidence`: concrete references (links, files, logs)
- `risk`: explicit risk rating (`low|medium|high`) with reason
- `actions`: ordered list of implementation-ready tasks

## Deterministic rules
1. Preserve user intent. Do not expand scope without explicit evidence.
2. Split cross-service work into child issues with owners and dependencies.
3. Emit acceptance criteria that are testable and binary.
4. Require both unit-test and end-to-end evidence for UI/API changes.

## Token optimization
- Use heading-first extraction and ignore conversational filler.
- Cap issue context summary at 400 tokens.
- Reuse canonical acceptance-criteria template.

## Stop conditions
- Missing key requirements -> return `blocked` action with exact missing field.
- Conflicting requirements -> escalate with two concrete options.
