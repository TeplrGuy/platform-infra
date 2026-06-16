# agentic-platform-infra

Infrastructure baseline for the Agentic SDLC demo platform in **West Europe**.

## What this repo contains

- `infra/main.bicep`: Core shared Azure platform resources and App Service apps
- `infra/main.dev.bicepparam`: Dev environment parameters
- `infra/main.test.bicepparam`: Test environment parameters
- `infra/main.prod.bicepparam`: Prod environment parameters
- `.github/workflows/infra-ci.yml`: Bicep validation workflow

## Resources provisioned

- App Service Plan (Linux)
- Web Apps:
  - `api-gateway`
  - `orders-service`
  - `inventory-service`
  - `notifications-service`
- Azure Key Vault
- Azure Service Bus namespace
- Log Analytics workspace
- Application Insights

## Deploy (example)

```bash
az deployment sub create \
  --name agentic-dev-bootstrap \
  --location westeurope \
  --template-file infra/main.bicep \
  --parameters infra/main.dev.bicepparam
```

