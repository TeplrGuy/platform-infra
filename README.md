# platform-infra

Infrastructure baseline for the SDLC demo platform in **West Europe**.

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

## Resources provisioned

- Azure Container Apps Environment
- Azure Container Registry
- Container Apps:
  - `api-gateway` (external ingress)
  - `orders-service` (internal ingress)
  - `inventory-service` (internal ingress)
  - `notifications-service` (internal ingress)
- Azure Key Vault
- Azure Service Bus namespace
- Log Analytics workspace
- Application Insights

## Deploy (example)

```bash
az deployment sub create \
  --name dev-bootstrap \
  --location westeurope \
  --template-file infra/main.bicep \
  --parameters infra/main.dev.bicepparam
```

## GitHub OIDC variables required

Set these repository variables in `platform-infra`:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID` (`d11cdc76-c6f2-4368-a98f-498e78a7e011`)
- `AZURE_SUBSCRIPTION_ID` (`8fcc5e8e-6540-4288-89e7-849e94290205`)

Then configure GitHub Environments `dev`, `test`, and `prod` with approval rules.
