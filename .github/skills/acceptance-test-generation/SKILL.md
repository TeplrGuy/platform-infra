---
name: acceptance-test-generation
description: Generate or improve focused automated tests from issue acceptance criteria for a service, contract, or infrastructure change.
---

# Acceptance-driven test generation

1. Read the issue, relevant repository instructions, changed behavior, and existing tests. Identify each testable acceptance criterion and any ambiguous or conflicting requirements; report blockers rather than inventing behavior.
2. Map each criterion to the smallest useful test layer: unit, service integration, contract, or end-to-end. Include meaningful negative cases, boundary values, and regressions where applicable. Use existing tools and fixtures.
3. Implement deterministic tests that assert observable behavior. Keep tests isolated; do not contact production, use real customer data, or depend on external services. Use an explicitly configured isolated test database when real database semantics are necessary.
4. Run the narrowest applicable checks first, then affected integration and end-to-end checks when available and authorized. A skipped or mocked test is not evidence that a real cross-service path passed. Never weaken a quality gate to obtain a pass.
5. Report a concise criterion-to-test mapping, exact commands and outcomes, links to CI evidence when available, and gaps or blockers. Do not claim completion for untested criteria.

Read only the issue, relevant code and tests first. Expand context only when required; summarize logs instead of copying them.
