# platform-infra

Infrastructure baseline for the SDLC demo platform in **North Europe**.

## What this repo contains

- `infra/main.bicep`: Subscription-level deployment entry point
- `infra/modules/`: Dev infrastructure modules
- `infra/main.parameters.json`: Planned dev environment parameters
- `infra/main.test.bicepparam`: Test environment parameters
- `infra/main.prod.bicepparam`: Prod environment parameters
- `.github/workflows/infra-ci.yml`: Bicep validation workflow
- `.github/workflows/deploy-dev.yml`: Dev infrastructure deployment
- `.github/workflows/promote-test.yml`: Test promotion deployment
- `.github/workflows/promote-prod.yml`: Prod promotion deployment
- `.github/workflows/rollback.yml`: Environment rollback to a known good Git ref
- `.github/workflows/full-stack-e2e.yml`: Manually run an unmocked browser journey across all five services

## Local full-stack browser rehearsal

With Node.js 24 installed, clone `portal-web`, `api-gateway`, `orders-service`, `inventory-service`, and
`notifications-service` beside this repository. Run `npm ci` in each, then
`npx playwright install chromium` in `portal-web`. Run
`node scripts/full-stack-e2e.js` from this repository. The script starts isolated
local services, runs the real browser flow, and stops its child processes. State
is in memory and is lost when the services stop.

The application Dockerfiles default to the public npm registry. In an
environment that requires a trusted registry mirror, supply its HTTPS URL as
the `NPM_CONFIG_REGISTRY` Docker build argument. Do not put credentials in the
URL or build arguments; use a secure build-time secret mechanism if needed.

For the durable-state integration check, install the service dependencies and
set `TEST_DATABASE_URL` to an isolated PostgreSQL database whose name ends in
`_test`. Run `node --test tests/postgres-state.test.js` from `platform-infra`,
with the application repositories cloned beside it. The check creates and deletes a uniquely
named schema, starts multiple replicas, and exercises concurrent reservations,
duplicate orders, and service restarts. It skips when `TEST_DATABASE_URL` is
unset. Do not point it at a shared or production database.

Run `node scripts/validate-telemetry.js` to additionally start a local OTLP
collector and assert that a single trace reaches all five services. The
rehearsal removes inherited Azure Monitor settings and only accepts a loopback
telemetry collector. It samples every local trace and waits for the expected
exports before stopping the services. This does not change production sampling
or verify Azure Monitor ingestion, alerts, or an SRE Agent connection.

When `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, each service initializes
Microsoft OpenTelemetry before loading Express. Traces propagate through Node's
`fetch`; request URL attributes are reduced to known route templates and query
values are redacted. Review telemetry and retention for your data classification
before using real customer data. Local instrumentation can instead use
`OTEL_EXPORTER_OTLP_ENDPOINT`.

The manually dispatched workflow accepts a ref for each application and records
the resolved commit SHAs in its job summary. Supply commit SHAs for repeatable
cross-repository evidence. It runs lint, syntax, unit and integration tests,
dependency audits, Playwright, and image builds, plus the durable-state test
against an ephemeral PostgreSQL service; the browser/trace journey remains in-memory.
GitHub requires the workflow to exist on the default branch before it can be
dispatched. It is not currently a required PR check or a deployment approval.

## Deployment status

The dev release workflow is intentionally blocked and performs no deployment.
It requires five full commit SHAs and runs Bicep and application quality gates
before the block. Azure provisioning and releases must use GitHub Actions, not
local or portal commands. Before the block can be removed, implement and verify
OIDC and least-privilege RBAC, Bicep what-if, immutable image promotion, secret
reuse, a `dev` environment approval, and live health checks. Building images in
the quality gate does not publish or promote them. A future release job must
serialize deployments without canceling pending or running work.
Public portal ingress defaults to disabled. A future staged release must first
create the portal internally, configure and verify Entra authentication, then
explicitly enable public ingress through the protected deployment pipeline.
The optional `verify_oidc` dispatch input runs a separate, human-approved
sign-in check against the protected `dev` environment. It grants no RBAC and
does not deploy resources; the release remains blocked even if it succeeds.
The optional `preview_bootstrap` input runs a read-only ARM what-if for the
resource group and saves its result and audit log. Its bootstrap role can create
or update resource groups throughout the subscription because Azure requires
subscription scope to create a resource group; it grants no access to workload
resources or role assignments. Remove this temporary role after bootstrapping.

## GitHub OIDC variables required

Set these variables on the `platform-infra` `dev` environment:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID` (`d11cdc76-c6f2-4368-a98f-498e78a7e011`)
- `AZURE_SUBSCRIPTION_ID` (`8fcc5e8e-6540-4288-89e7-849e94290205`)

The `dev` environment requires an approved human reviewer and disables admin
bypass. Self-review is allowed because TeplrGuy is the only available reviewer;
this is not independent review. Configure and verify appropriate protection for
`test` and `prod` before enabling those releases.

## Customer walkthrough (day-in-the-life)

1. Start with a GitHub issue and acceptance criteria in one of the service repos.
2. Implement in a short-lived branch, open a PR, and link the issue.
3. Use PR checklist + CODEOWNERS + `ci` + `security` workflows as merge gates.
4. Deployment workflows are deliberately blocked: the templates still use placeholder application images. Implement and verify immutable releases before enabling them.
5. Rollback is deliberately blocked: redeploying a Git ref does not restore a verified application image. Establish image-based rollback before enabling it.
6. Use `portal-web` to demonstrate the visible customer flow and link the runtime behavior back to GitHub issues, PRs, and workflows.
