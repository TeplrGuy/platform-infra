---
name: playwright-journey-testing
description: Design and maintain deterministic Playwright tests for browser journeys, accessibility, error handling, and cross-service evidence.
---

# Playwright journey testing

1. Read the issue's acceptance criteria, repository test instructions, and existing Playwright configuration, fixtures, and tests. Map user-visible outcomes to focused scenarios.
2. Prefer roles, labels and accessible names; use test IDs only when necessary. Assert meaningful state, navigation and errors, including keyboard interaction when applicable. Avoid fixed sleeps and brittle DOM selectors.
3. Use deterministic mock data for UI-focused cases, including empty and failed responses. Mark mocked coverage explicitly; it does not prove a backend integration.
4. When a real cross-service rehearsal is required, use the repository's existing isolated test environment and test data. Never target production or create persistent resources without authorization. Record the component revisions and configuration used.
5. Run the smallest relevant Playwright selection and applicable lint or service checks. Report exact commands, results, evidence links, and any skipped, flaky or blocked scenarios; do not treat retries or skipped tests as a pass.

Avoid installing browsers or dependencies unless needed and authorized. Do not expose credentials, traces containing personal data, or sensitive payloads in artifacts.
