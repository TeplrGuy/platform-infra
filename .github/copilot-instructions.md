# Copilot Instructions for platform-infra

This repository owns shared Azure infrastructure for the demo environment across services and environments.

## Load order
1. Read `.github/instructions/global-engineering-standards.md` when present.
2. Read the GitHub issue or PR body and follow task-specific constraints.

## Mandatory skill bootstrap (cloud and local)
1. Read `.github/skills/skills.lock.json`.
2. Read `.github/skills/skills-manifest.json`.
3. Load at least one relevant skill contract before implementation:
   - Issue shaping/triage: `.github/skills/issue-triage/v1/SKILL.md`
   - PR analysis/review: `.github/skills/pr-review/v1/SKILL.md`
   - Test strategy: `.github/skills/test-plan/v1/SKILL.md`
   - Contract impact: `.github/skills/contract-impact/v1/SKILL.md`
   - Incident handling: `.github/skills/incident-response/v1/SKILL.md`
4. Follow the active skill output contract (`summary`, `evidence`, `risk`, `actions`) for issue/PR conclusions.
5. If required skill files are missing, stop and call out the gap instead of improvising.

## Token discipline
- Read minimally: issue/PR body, changed files, and referenced constraints first.
- Do not paste long logs/files; link them and summarize with concise bullets.
- Keep outputs short, evidence-first, and action-oriented.
