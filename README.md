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
4. Run `deploy-dev` after merge, validate behavior, and promote with `promote-test` then `promote-prod`.
5. If degradation appears, run `rollback` with the last known good commit SHA and document follow-up actions in a new issue.
6. Use `portal-web` to demonstrate the visible customer flow and link the runtime behavior back to GitHub issues, PRs, and workflows.
