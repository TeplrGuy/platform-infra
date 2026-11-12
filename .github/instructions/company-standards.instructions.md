---
applyTo: "**"
---
# Shared engineering standards

The canonical source is `TeplrGuy/engineering-skills/standards/company.instructions.md`.
Consumer copies are pinned by `.github/standards.lock.json`. Propose policy changes
in the canonical repository and roll them out through reviewed pull requests.

## Scope and architecture

- Implement one bounded issue per branch and active implementer. Read the issue,
  repository instructions, relevant path instructions and applicable skill first.
- Make the smallest complete change; avoid unrelated refactors.
- Preserve compatibility, service ownership and explicit cross-repository contracts.
- Keep the portal behind the gateway. Keep business behavior in the owning service.
- Resolve conflicting requirements before implementation; do not silently change a
  contract or status vocabulary. Record approved mappings and test them.

## Quality and evidence

- Follow the repository's language, naming, formatting and tooling.
- Run existing lint, syntax, unit/service and integration checks. Add focused
  behavioral tests for changes; do not substitute syntax checks for unit tests.
- Validate the affected end-to-end path. UI changes require browser coverage and
  screenshots; contract changes require consuming-service compatibility evidence.
- Link exact source revisions, CI results and end-to-end evidence in the PR.
- Aim for unit tests under 30 seconds and fast CI feedback under three minutes;
  report actual measurements rather than claiming these targets are enforced.
- Keep PRs small; justify files outside the issue's expected scope.
- An agent's self-review is not independent review. A human must verify test
  coverage before merge. Retain required checks, reviewers and deployment gates.
- Never mark an issue Done just because a branch, draft PR or green local test exists.

## Security and operations

- Never commit credentials or log secrets or sensitive user data.
- Use environment configuration and least-privilege identities.
- Preserve correlation IDs across service boundaries and record actionable errors.
- Keep health checks stable; surface dependency failures rather than masking them.
- Infrastructure and application deployment run through approved GitHub Actions,
  using OIDC, immutable image digests, what-if and protected environment approval.
- Do not weaken authentication, TLS, isolation or required checks to make a demo pass.
- Escalate production secrets, broader permissions and breaking changes.

## Agent context, Spaces and Memory

- Use repository instructions for durable requirements; read relevant skills and
  comply with their evidence, risk and action output contracts.
- Use a Copilot Space as a curated context index for standards, architecture,
  contracts, epic and runbooks. A Space is not an enforcement mechanism or proof
  that a coding session automatically loaded its contents.
- Use Copilot Memory only for verified repository facts and preferences supported
  by citations. Revalidate memories against current source. Never store secrets,
  approvals, temporary task status or company policy exclusively in memory.
- Keep context small and relevant. Respect Agentic Workflow safe-output and credit
  limits; do not duplicate triage issues or enable paid schedules casually.
- Instructions guide agents; required CI checks, CODEOWNERS/review rules and
  protected environments provide deterministic governance.
