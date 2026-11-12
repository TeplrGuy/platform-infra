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
node scripts/private-preview.js parameters > private-parameters.json
azure private-what-if deployment group what-if --name "private-preview-$GITHUB_RUN_ID" \
  --resource-group agtsdlc-dev-rg --template-file infra/private-workloads.bicep \
  --parameters @private-parameters.json --no-pretty-print --no-prompt --output json |
  node scripts/runtime-preview.js sanitize > private-what-if.json
node scripts/private-preview.js validate private-what-if.json "$domain"
printf '%s\n' "$domain" > private-domain.txt
git ls-files -z infra scripts/private-preview.sh scripts/private-preview.js scripts/runtime-preview.js |
  xargs -0 sha256sum > private-template.sha256
