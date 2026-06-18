# APM-Aligned Agent Operations

This repository adopts proven operating practices inspired by `microsoft/apm`, adapted for this demo environment.

## 1) Deterministic load policy
- Load only task-relevant context first (issue/PR + touched files + repo instructions).
- Use staged context loading:
  - **Load first**: issue/PR, `copilot-instructions.md`, affected files.
  - **Load if needed**: cross-service dependencies and downstream contract files.
  - **Avoid unless blocked**: unrelated modules and large logs.

## 2) Cost and token governance
- Keep summaries concise and evidence-first.
- Prefer links + bullet evidence over pasted logs/diffs.
- Respect workflow `max-ai-credits` ceilings.

## 3) Safe-output discipline
- One synthesized issue/PR comment per run unless explicitly needed.
- Labels/comments/actions must stay within workflow `safe-outputs` bounds.

## 4) Session and ownership safety
- One branch = one active implementer session.
- Reviewer should be separate from implementer.
- Do not push directly to protected branches.

## 5) CI-first claims
- Do not claim done/green without matching CI evidence.
- PR evidence should include both narrow tests and end-to-end path validation.