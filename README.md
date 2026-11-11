# platform-infra

Infrastructure baseline for the SDLC demo platform in **North Europe**.

## What this repo contains

- `infra/main.bicep`: Subscription-level deployment entry point
- `infra/platform-resources.bicep`: Core shared platform resources and Container Apps
- `infra/main.dev.bicepparam`: Dev environment parameters
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

Run `node scripts/validate-telemetry.js` to additionally start a local OTLP
collector and assert that a single trace reaches all five services. The
rehearsal removes inherited Azure Monitor settings and only accepts a loopback
telemetry collector. This checks propagation locally; it does not verify Azure
Monitor ingestion, alerts, or an SRE Agent connection.

When `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, each service initializes
Microsoft OpenTelemetry before loading Express. Traces propagate through Node's
`fetch`; request URL attributes are reduced to known route templates and query
values are redacted. Review telemetry and retention for your data classification
before using real customer data. Local instrumentation can instead use
`OTEL_EXPORTER_OTLP_ENDPOINT`.

The manually dispatched workflow tests the chosen portal ref with the other
repositories' default branches; record commit SHAs when using it as evidence.
It is not currently a required PR check or a deployment approval.

## Resources provisioned

- Azure Container Apps Environment
- Azure Container Registry
- Container Apps:
  - `portal` (external ingress)
  - `apigw` (external ingress)
  - `orders` (internal ingress)
  - `inventory` (internal ingress)
  - `notify` (internal ingress)
- Azure Key Vault
- Azure Service Bus namespace
- Log Analytics workspace
- Application Insights

## Deploy (example)

```bash
az deployment sub create \
  --name dev-bootstrap \
  --location northeurope \
  --template-file infra/main.bicep \
  --parameters infra/main.dev.bicepparam
```

## GitHub OIDC variables required

Set these repository variables in `platform-infra`:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID` (`d11cdc76-c6f2-4368-a98f-498e78a7e011`)
- `AZURE_SUBSCRIPTION_ID` (`8fcc5e8e-6540-4288-89e7-849e94290205`)

Then configure GitHub Environments `dev`, `test`, and `prod` with approval rules.

## Customer walkthrough (day-in-the-life)

1. Start with a GitHub issue and acceptance criteria in one of the service repos.
2. Implement in a short-lived branch, open a PR, and link the issue.
3. Use PR checklist + CODEOWNERS + `ci` + `security` workflows as merge gates.
4. The current deployment workflows provision infrastructure; they do not yet build or promote the application images. Do not treat them as application release gates.
5. The current rollback workflow deploys a Git ref, not a verified application image. Establish image-based rollback before relying on it for a customer demonstration.
6. Use `portal-web` to demonstrate the visible customer flow and link the runtime behavior back to GitHub issues, PRs, and workflows.
