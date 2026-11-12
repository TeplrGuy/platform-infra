# platform-infra

Infrastructure baseline for the SDLC demo platform in **North Europe**.

## What this repo contains

- `infra/main.bicep`: Resource-group-level application deployment entry point
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
against an ephemeral PostgreSQL service. Built images receive individual
container health checks against that database; the browser/trace journey remains
in-memory and does not exercise the built containers end to end.
The optional `preserve_images` input saves those exact images and their source
revisions for later promotion; it does not publish or deploy them. The manifest
records local image IDs, not registry manifest digests. A future publisher must
verify the archive and record immutable registry digests after pushing.
`scripts/verify-image-artifact.js` checks archive and manifest hashes against
the five selected source revisions and verifies Docker image IDs before upload. It
does not authenticate an artifact's source; the release must also obtain it
from the expected successful quality job and workflow run.
When preserving images, supply full commit SHAs for all five inputs; branch
names are not accepted as image provenance.
`foundation_action: publish-images` publishes only the current run's
quality-gated image artifact after protected environment approval. It records
registry manifest digests, independently checked against the pushed digests;
it does not deploy the application.
GitHub requires the workflow to exist on the default branch before it can be
dispatched. It is not currently a required PR check or a deployment approval.

## Deployment status

The dev workflow now has separate preview/apply actions for private workloads
and an Entra-protected public portal. These actions have not been run from this
working branch and do not imply that a release is currently deployed. Azure
provisioning and releases must use GitHub Actions, not local or portal commands.
The actions require the approved OIDC identity, matching pinned image
provenance, a protected `dev` environment approval for apply, and
post-deployment verification. Building images in the quality gate does not
publish or promote them. Apply jobs serialize deployments without canceling
pending or running work.
Public portal ingress defaults to disabled. The staged public action explicitly
enables ingress only for the portal and configures built-in Entra authentication
before reporting the public URL.
Service-to-service URLs use HTTPS and the internal Container Apps hostname
format (`<app>.internal.<environment-domain>`). These endpoints are reachable
only from apps in the same environment, so live backend probes must run there,
not directly on a public GitHub-hosted runner. See
[Container Apps service discovery](https://learn.microsoft.com/azure/container-apps/connect-apps).
Application identities and registry/Key Vault role assignments are created
before the apps. Application creation defaults off via `deployApplications`;
the staged publisher and workload actions use those existing assignments.
This parameter is not itself a release pipeline.
`infra/foundation.bicep` contains the registry, vault, application identities,
and deployer access without creating application or database resources. Its
first-stage preview omits application role assignments, whose principal IDs
are unknown until the identities exist. `infra/foundation-access.bicep`
accepts principal IDs from those existing identities for a later access stage. A protected
pipeline must still preview and apply those assignments before any application release. The
`foundation_action: preview` runs a read-only what-if.
`foundation_action: apply` requires the preview, full quality gates and a
separate protected environment approval; it rechecks the approved preview
before applying only the foundation. The preview validator accepts only the nine approved initial
creations and can compare a post-approval recheck against the reviewed preview.
It intentionally rejects retries against an already-created foundation; a safe
reconciliation path is still required.
`foundation_action: runtime-apply` is a separate staged prerequisite rollout:
preview a missing database credential, require a protected approval and matching
recheck, then generate it once into Key Vault through Bicep. An existing
credential is reused; a database without its recorded credential blocks the
seed rather than resetting its password. Secure values enter Bicep through
environment-backed `.bicepparam` files and are excluded from stored previews.
After quality gates, a second preview/approval/recheck deploys only the planned
North Europe PostgreSQL, telemetry and Container Apps environment. It creates
no application workloads, role grants or Entra registration. New runtime apply
jobs use a non-canceling FIFO queue.
For the partial runtime deployment in run 43175062572, `runtime-recovery`
previews and applies only the PostgreSQL extension setting and a new database
URL secret. It checks that the existing server is ready with the expected
administrator and reuses the recorded credential version; it refuses to
overwrite an existing database URL. It never redeploys the server or database.
`foundation_action: private-preview` performs a read-only what-if for five
internal workloads using the exact source revisions and registry digests from
publisher run 43133264052. It verifies private ingress, scoped identities,
image digests, service URLs and database secret references, and redacts telemetry
credentials before storing the preview. Azure may return unresolved resource
references and mask secret names: the validator accepts only the exact scoped
references and checks the compiled secret and environment expressions against
reviewed hashes. Intentional changes to those expressions require reviewing and
updating the hashes. The workflow checks the live registry and vault endpoints
and uses the same compiled template for its what-if. It does not deploy workloads.
`foundation_action: private-apply` runs that preview followed by a separate
protected `dev` approval, then checks the template, parameters and a fresh what-if
against the approved preview before applying only the five private workloads.
This initial create-only path fails closed if applications already exist; recovery
requires a separate reviewed path. It does not establish application health or
enable public access.
`foundation_action: public-preview` is read-only and validates the exact pinned
image digests, North Europe target, portal-only public ingress, Entra auth
configuration, and redacted Key Vault secret scope. `public-apply` repeats the
preview in a separate `dev` environment job, compares it with the approved
artifact, then applies the Entra configuration and public portal ingress.
It reads back all five app images and ingress settings, checks the portal
callback URL, requires anonymous requests to redirect to the configured Entra
tenant/client, then runs the in-environment health and scale-to-zero durability
journey. The workflow reports the portal URL only after those checks pass.
Public promotion refuses input refs that differ from `infra/private-release.json`;
updating that manifest requires an independently reviewed, immutable publisher
record. A newer feature PR is not deployable merely because its source SHA was
supplied to workflow dispatch.
`foundation_action: health-preview` previews a separate manual, read-only
Container Apps Job for checking private service health from within the same
environment. Preview alone neither creates nor runs the job.
`foundation_action: health-apply` uses a separate protected approval and
matching recheck to create the job, then validates its Azure readback. It does
not start the job or prove application health.
`foundation_action: health-run` validates the existing job's deployed image,
identity and probe code, then starts its read-only checks from the private
environment and fails if the execution fails or times out.
The test, production, and rollback workflows remain blocked and must be
adapted to resource-group-scope deployment and verified before enabling them.
`infra/rg-rbac-condition.txt` is a proposed Azure RBAC condition for scoped
bootstrap: it restricts role assignment writes and deletes to the four required
registry/vault roles and service principals. The deployment identity has this
condition at the demo resource group; functional enforcement still needs to be
verified through the pipeline.
The optional `verify_oidc` dispatch input runs a separate, human-approved
sign-in check against the protected `dev` environment. It grants no RBAC and
does not deploy resources; run the corresponding preview/apply action for a
workload change.
The optional `preview_bootstrap` input runs a read-only ARM what-if for the
resource group and saves its result and audit log. Its bootstrap role can create
or update resource groups throughout the subscription because Azure requires
subscription scope to create a resource group; it grants no access to workload
resources or role assignments. Remove this temporary role after bootstrapping.
The separate `bootstrap_rg` input previews and, after a second protected
approval and a matching recheck, creates only the approved resource group. It
does not deploy the application.

## GitHub OIDC variables required

Set these variables on the `platform-infra` `dev` environment:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID` (`d11cdc76-c6f2-4368-a98f-498e78a7e011`)
- `AZURE_SUBSCRIPTION_ID` (`8fcc5e8e-6540-4288-89e7-849e94290205`)

The `dev` environment requires an approved human reviewer and disables admin
bypass. Self-review is allowed because TeplrGuy is the only available reviewer;
this is not independent review. Configure and verify appropriate protection for
`test` and `prod` before enabling those releases.
The public portal workflow requires `ENTRA_CLIENT_ID` and `ENTRA_TENANT_ID` as
`dev` environment variables. Before `public-apply`, set the exact callback
`ENTRA_REDIRECT_URI` as a `dev` environment variable and `ENTRA_CLIENT_SECRET`
as a protected `dev` environment secret. Register the callback URI printed by
the public preview for the web application. Never place the secret in a
repository file or workflow artifact. The public action is available only after
this workflow change is reviewed and merged to the default branch.

## Customer walkthrough (day-in-the-life)

1. Start with a GitHub issue and acceptance criteria in one of the service repos.
2. Implement in a short-lived branch, open a PR, and link the issue.
3. Use PR checklist + CODEOWNERS + `ci` + `security` workflows as merge gates.
4. For a live demo, use only a reviewed immutable release through the staged private and public `dev` actions; the public portal requires Entra sign-in and its URL is reported only after health and durability checks pass.
5. Test, production, and rollback releases remain blocked until their resource scopes and verified image rollback paths are independently implemented.
6. Use `portal-web` to demonstrate the visible customer flow and link the runtime behavior back to GitHub issues, PRs, and workflows.
