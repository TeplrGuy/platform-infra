#!/usr/bin/env bash
set -euo pipefail

mode="${1:-preview}"
[[ "$mode" == preview || "$mode" == apply ]] || { echo "::error::Unknown public release stage."; exit 1; }
if [[ "${GITHUB_ACTIONS:-}" != true || "${GITHUB_REPOSITORY:-}" != TeplrGuy/platform-infra ||
      "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]]; then
  echo "::error::Public promotion is restricted to the protected GitHub Actions workflow."
  exit 1
fi

audit() { printf '%s run=%s commit=%s\n' "$*" "$GITHUB_RUN_ID" "$GITHUB_SHA" | tee -a public-release-audit.log >&2; }
azure() {
  local label="$1"
  shift
  audit "started $label"
  if az "$@"; then audit "succeeded $label"; else
    local code=$?
    audit "failed $label exit=$code"
    return "$code"
  fi
}

preview_public_what_if() {
  local raw_json="public-what-if.raw.json"
  local stderr_log="public-what-if.stderr.log"
  local attempts=3
  local delay_seconds=5
  : > "$stderr_log"
  rm -f "$raw_json"
  for ((attempt=1; attempt<=attempts; attempt++)); do
    audit "started public-what-if attempt=$attempt"
    if az deployment group what-if --name "public-preview-$GITHUB_RUN_ID" \
      --resource-group agtsdlc-dev-rg --parameters infra/public-workloads.bicepparam \
      --no-pretty-print --no-prompt --output json > "$raw_json" 2>> "$stderr_log"; then
      if [[ -s "$raw_json" ]] && jq -e '.' "$raw_json" >/dev/null 2>&1; then
        audit "succeeded public-what-if attempt=$attempt"
        return 0
      fi
      audit "failed public-what-if-invalid-json attempt=$attempt"
      printf 'what-if returned non-JSON payload on attempt %s\n' "$attempt" >> "$stderr_log"
    else
      local code=$?
      audit "failed public-what-if attempt=$attempt exit=$code"
    fi
    if (( attempt < attempts )); then
      sleep "$delay_seconds"
      delay_seconds=$((delay_seconds * 2))
    fi
  done
  if grep -q 'ReadOnlyDisabledSubscription' "$stderr_log"; then
    echo "::error::Azure reports the target subscription is read-only/disabled. Re-enable or upgrade the subscription offer, then rerun public-preview."
  fi
  echo "::error::Public what-if failed after retrying. See public-what-if.stderr.log for diagnostics."
  return 1
}

[[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ && "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] ||
  { echo "::error::Workflow run or checkout revision is invalid."; exit 1; }
[[ "${ENTRA_CLIENT_ID:-}" =~ ^[a-fA-F0-9]{8}-([a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$ &&
   "${ENTRA_TENANT_ID:-}" == "16b3c013-d300-468d-ac64-7eda0820b6d3" ]] ||
  { echo "::error::Configure the approved Entra client and tenant in the protected dev environment."; exit 1; }
if [[ "$mode" == apply && -z "${ENTRA_CLIENT_SECRET:-}" ]]; then
  echo "::error::The protected dev environment is missing ENTRA_CLIENT_SECRET."
  exit 1
fi

azure account account show --output json |
  jq -e 'select(.id == "b6f10878-9f8a-4b3f-8bc5-3464cdd79c77" and
    .tenantId == "16b3c013-d300-468d-ac64-7eda0820b6d3" and
    .user.type == "servicePrincipal")' >/dev/null ||
  { echo "::error::The public release identity does not match the approved Azure target."; exit 1; }

location="$(azure resource-group group show --name agtsdlc-dev-rg --query location --output tsv)"
[[ "$location" == northeurope ]] || { echo "::error::The approved dev resource group is not in North Europe."; exit 1; }
environment="$(azure environment resource show \
  --ids "/subscriptions/b6f10878-9f8a-4b3f-8bc5-3464cdd79c77/resourceGroups/agtsdlc-dev-rg/providers/Microsoft.App/managedEnvironments/cae-agentsdlc-dev-7c77" \
  --api-version 2026-07-01 --query '{state:properties.provisioningState,domain:properties.defaultDomain}' --output json)"
[[ "$(jq -r '.state' <<< "$environment")" == Succeeded ]] || { echo "::error::The dev Container Apps environment is not ready."; exit 1; }
domain="$(jq -er '.domain' <<< "$environment")"

az bicep build --file infra/public-workloads.bicep --stdout > public-compiled.json
callback_uri="https://$(node -p "require('./infra/foundation.parameters.json').parameters.appNames.value[0]").$domain/.auth/login/aad/callback"
portal_url="https://$(node -p "require('./infra/foundation.parameters.json').parameters.appNames.value[0]").$domain"
if [[ -n "${ENTRA_REDIRECT_URI:-}" && "$ENTRA_REDIRECT_URI" != "$callback_uri" ]]; then
  echo "::error::ENTRA_REDIRECT_URI does not match the callback URI for the approved portal."
  exit 1
fi
if [[ "$mode" == apply && "${ENTRA_REDIRECT_URI:-}" != "$callback_uri" ]]; then
  echo "::error::Register the exact portal callback URI in Entra and set ENTRA_REDIRECT_URI before applying."
  exit 1
fi

preview_public_what_if
node scripts/runtime-preview.js sanitize < public-what-if.raw.json > public-what-if.json
node scripts/public-preview.js public-what-if.json "$domain" public-compiled.json
printf '%s\n' "$domain" > public-domain.txt
printf '%s\n' "$callback_uri" > public-callback-uri.txt
printf '%s\n' "$portal_url" > public-url.txt
git ls-files -z infra scripts/public-stage.sh scripts/public-preview.js scripts/runtime-preview.js |
  xargs -0 sha256sum > public-template.sha256
if [[ "$mode" == preview ]]; then
  {
    echo "Expected portal URL: $portal_url"
    echo "Required Entra callback URI: $callback_uri"
  } >> "$GITHUB_STEP_SUMMARY"
  audit "public release preview complete; no resources changed"
  exit 0
fi

cmp -s public-domain.txt approved-public/public-domain.txt ||
  { echo "::error::The Container Apps domain changed after preview."; exit 1; }
cmp -s public-callback-uri.txt approved-public/public-callback-uri.txt ||
  { echo "::error::The Entra callback URI changed after preview."; exit 1; }
cmp -s public-url.txt approved-public/public-url.txt ||
  { echo "::error::The public portal URL changed after preview."; exit 1; }
sha256sum --check approved-public/public-template.sha256
node scripts/public-preview.js public-what-if.json "$domain" public-compiled.json approved-public/public-what-if.json

deployment="public-workloads-$GITHUB_RUN_ID"
state="$(azure public-apply deployment group create --name "$deployment" --resource-group agtsdlc-dev-rg \
  --parameters infra/public-workloads.bicepparam --mode Incremental \
  --query properties.provisioningState --output tsv)"
[[ "$state" == Succeeded ]] || { echo "::error::Public workload deployment did not succeed."; exit 1; }

live_apps='[]'
while IFS= read -r name; do
  app="$(azure "verify-$name" containerapp show --name "$name" --resource-group agtsdlc-dev-rg \
    --query '{state:properties.provisioningState,external:properties.configuration.ingress.external,fqdn:properties.configuration.ingress.fqdn,targetPort:properties.configuration.ingress.targetPort,image:properties.template.containers[0].image}' \
    --output json)"
  live_apps="$(node -e 'const a=JSON.parse(process.argv[1]); const xs=JSON.parse(process.argv[2]); xs.push(a); process.stdout.write(JSON.stringify(xs));' "$app" "$live_apps")"
done < <(node -e 'for(const name of require("./infra/foundation.parameters.json").parameters.appNames.value) console.log(name)')
printf '%s\n' "$live_apps" > public-live-apps.json
auth="$(azure public-auth-readback containerapp auth show \
  --name "$(node -p "require('./infra/foundation.parameters.json').parameters.appNames.value[0]")" \
  --resource-group agtsdlc-dev-rg --output json)"
node - "$auth" "$domain" "$ENTRA_CLIENT_ID" "$ENTRA_TENANT_ID" <<'NODE'
const fs = require('node:fs');
const { validateLive } = require('./scripts/public-preview');
const refs = Object.fromEntries(['PORTAL_REF', 'GATEWAY_REF', 'ORDERS_REF', 'INVENTORY_REF', 'NOTIFICATIONS_REF']
  .map(name => [name, process.env[name]]));
validateLive(JSON.parse(fs.readFileSync('public-live-apps.json', 'utf8')),
  JSON.parse(process.argv[2]), process.argv[3], refs, process.argv[4], process.argv[5]);
NODE
redirect="$(curl --silent --show-error --max-time 30 --max-redirs 0 --dump-header - \
  --output /dev/null --write-out $'\n%{http_code}' "$portal_url")"
printf '%s' "$redirect" | node -e '
const { validateLoginRedirect } = require("./scripts/public-preview");
let response = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => response += chunk);
process.stdin.on("end", () => validateLoginRedirect(response, process.argv[1], process.argv[2]));
' "$ENTRA_CLIENT_ID" "$ENTRA_TENANT_ID"
bash scripts/health-stage.sh run
PUBLIC_PORTAL_EXPECTED=true bash scripts/journey-stage.sh
printf '%s\n' "$portal_url" > public-url.txt
{
  echo "## Public dev portal release"
  echo
  echo "Portal: $portal_url"
  echo "Entra callback: $callback_uri"
  echo
  echo "Unauthenticated Entra redirect, private health, and scale-to-zero durability checks passed."
} >> "$GITHUB_STEP_SUMMARY"
audit "public portal deployed; Entra redirect, private health, and durability checks passed"
