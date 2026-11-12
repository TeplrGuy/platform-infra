#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != true || "${GITHUB_REPOSITORY:-}" != TeplrGuy/platform-infra ||
      "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]]; then
  echo "::error::Private preview requires the protected GitHub Actions workflow."
  exit 1
fi

audit() {
  printf '%s run=%s commit=%s\n' "$*" "$GITHUB_RUN_ID" "$GITHUB_SHA" | tee -a private-preview-audit.log >&2
}

azure() {
  local label="$1"
  shift
  audit "started $label"
  if az "$@"; then
    audit "succeeded $label"
  else
    local code=$?
    audit "failed $label exit=$code"
    return "$code"
  fi
}

azure account account show --output json |
  node -e 'let s=""; process.stdin.on("data", c => s+=c).on("end", () => {
    const a=JSON.parse(s);
    if (a.id !== "8fcc5e8e-6540-4288-89e7-849e94290205" ||
        a.tenantId !== "d11cdc76-c6f2-4368-a98f-498e78a7e011" ||
        a.user?.name !== "8148728e-6852-4c3a-91dd-9e3bc87c565e" || a.user?.type !== "servicePrincipal")
      throw Error("The preview identity does not match the approved target.");
  });'
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo "::error::Checkout revision mismatch."; exit 1; }
location="$(azure resource-group group show --name agtsdlc-dev-rg --query location --output tsv)"
[[ "$location" == northeurope ]] || { echo "::error::Resource group location changed."; exit 1; }
environment_id="/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb"
environment="$(azure environment resource show --ids "$environment_id" --api-version 2026-07-01 \
  --query '{state:properties.provisioningState,domain:properties.defaultDomain}' --output json)"
[[ "$(jq -r '.state' <<< "$environment")" == Succeeded ]] || { echo "::error::Runtime environment is not ready."; exit 1; }
domain="$(jq -er '.domain' <<< "$environment")"
registry_server="$(azure registry resource show --ids "/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/Microsoft.ContainerRegistry/registries/cragentsdlcdev55eb" --api-version 2025-11-01 --query properties.loginServer --output tsv)"
vault_uri="$(azure vault resource show --ids "/subscriptions/8fcc5e8e-6540-4288-89e-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb" --api-version 2026-05-15 --query properties.vaultUri --output tsv)"
[[ "$registry_server" == cragentsdlcdev55eb.azurecr.io && "$vault_uri" == https://kv-agentsdlc-dev-55eb.vault.azure.net/ ]] ||
  { echo "::error::Registry or vault endpoint differs from the approved target."; exit 1; }
node scripts/private-preview.js parameters > private-parameters.json
az bicep build --file infra/private-workloads.bicep --stdout > private-compiled.json
azure private-what-if deployment group what-if --name "private-preview-$GITHUB_RUN_ID" \
  --resource-group agtsdlc-dev-rg --template-file private-compiled.json \
  --parameters @private-parameters.json --no-pretty-print --no-prompt --output json |
  node scripts/runtime-preview.js sanitize > private-what-if.json
node scripts/private-preview.js validate private-what-if.json "$domain" private-compiled.json
printf '%s\n' "$domain" > private-domain.txt
git ls-files -z infra scripts/private-preview.sh scripts/private-preview.js scripts/runtime-preview.js |
  xargs -0 sha256sum > private-template.sha256
sha256sum private-compiled.json >> private-template.sha256
