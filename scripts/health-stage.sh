#!/usr/bin/env bash
set -euo pipefail

mode="${1:-preview}"
[[ "$mode" == preview || "$mode" == apply || "$mode" == run || "$mode" == verify ]] || { echo "::error::Unknown health job stage."; exit 1; }
if [[ "${GITHUB_ACTIONS:-}" != true || "${GITHUB_REPOSITORY:-}" != TeplrGuy/platform-infra ||
      "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]]; then
  echo "::error::Private health preview requires the protected GitHub Actions workflow."
  exit 1
fi

audit() { printf '%s run=%s commit=%s\n' "$*" "$GITHUB_RUN_ID" "$GITHUB_SHA" | tee -a health-audit.log >&2; }
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

azure account account show --output json |
  node -e 'let s=""; process.stdin.on("data", c => s+=c).on("end", () => {
    const a=JSON.parse(s);
    if (a.id !== "b6f10878-9f8a-4b3f-8bc5-3464cdd79c77" ||
        a.tenantId !== "16b3c013-d300-468d-ac64-7eda0820b6d3" ||
        a.user?.type !== "servicePrincipal")
      throw Error("The health preview identity does not match the approved target.");
  });'
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo "::error::Checkout revision mismatch."; exit 1; }
scope="/subscriptions/b6f10878-9f8a-4b3f-8bc5-3464cdd79c77/resourceGroups/agtsdlc-dev-rg/providers"
location="$(azure resource-group group show --name agtsdlc-dev-rg --query location --output tsv)"
[[ "$location" == northeurope ]] || { echo "::error::Resource group location changed."; exit 1; }
environment="$(azure environment resource show --ids "$scope/Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb" \
  --api-version 2026-07-01 --query '{state:properties.provisioningState,domain:properties.defaultDomain}' --output json)"
[[ "$(jq -r '.state' <<< "$environment")" == Succeeded ]] || { echo "::error::Runtime environment is not ready."; exit 1; }
domain="$(jq -er '.domain' <<< "$environment")"

readback() {
  azure health-readback resource show --ids "$scope/Microsoft.App/jobs/job-agentsdlc-dev-55eb-health" \
    --api-version 2026-07-01 --output json |
    node scripts/runtime-preview.js sanitize > health-live.json
  node -e '
    const fs = require("node:fs");
    const job = JSON.parse(fs.readFileSync("health-live.json", "utf8"));
    if (job.properties?.provisioningState !== "Succeeded") throw Error("The health job is not provisioned.");
    require("./scripts/health-preview").validate(
      {status:"Succeeded", changes:[{changeType:"Create", resourceId:job.id, after:job}]},
      process.argv[1], fs.readFileSync("scripts/private-health.js", "utf8"));
  ' "$domain"
}

if [[ "$mode" == verify ]]; then
  readback
  printf '%s\n' "$domain" > health-domain.txt
  exit 0
fi

if [[ "$mode" == run ]]; then
  readback
  execution="$(azure health-start containerapp job start --name job-agentsdlc-dev-55eb-health \
    --resource-group agtsdlc-dev-rg --query name --output tsv)"
  [[ "$execution" =~ ^job-agentsdlc-dev-55eb-health-[a-z0-9]+$ ]] ||
    { echo "::error::Health job execution identifier is unexpected."; exit 1; }
  printf '%s\n' "$execution" > health-execution.txt
  for ((attempt=0; attempt<72; attempt++)); do
    status="$(azure health-status containerapp job execution show --name job-agentsdlc-dev-55eb-health \
      --resource-group agtsdlc-dev-rg --job-execution-name "$execution" --query properties.status --output tsv)"
    case "$status" in
      Succeeded) audit "health execution succeeded execution=$execution"; exit 0 ;;
      Failed|Stopped) echo "::error::Health execution $execution ended with status $status."; exit 1 ;;
      Running|Processing|Pending) sleep 10 ;;
      *) echo "::error::Unexpected health execution status: $status"; exit 1 ;;
    esac
  done
  echo "::error::Health execution $execution did not complete within the polling window."
  exit 1
fi

az bicep build --file infra/private-health.bicep --stdout > health-compiled.json
azure health-what-if deployment group what-if --name "health-preview-$GITHUB_RUN_ID" \
  --resource-group agtsdlc-dev-rg --template-file health-compiled.json --no-pretty-print --no-prompt --output json |
  node scripts/runtime-preview.js sanitize > health-what-if.json
node scripts/health-preview.js health-what-if.json "$domain"
printf '%s\n' "$domain" > health-domain.txt
git ls-files -z infra scripts/private-health.js scripts/health-preview.js scripts/health-stage.sh scripts/runtime-preview.js |
  xargs -0 sha256sum > health-template.sha256
sha256sum health-compiled.json >> health-template.sha256
if [[ "$mode" == apply ]]; then
  cmp -s health-domain.txt approved-health/health-domain.txt ||
    { echo "::error::Health environment domain changed after approval."; exit 1; }
  sha256sum --check approved-health/health-template.sha256
  node scripts/health-preview.js health-what-if.json "$domain" approved-health/health-what-if.json
  deployment="health-job-$GITHUB_RUN_ID"
  audit "started health-apply deployment=$deployment"
  if ! state="$(az deployment group create --name "$deployment" --resource-group agtsdlc-dev-rg \
    --template-file health-compiled.json --mode Incremental \
    --query properties.provisioningState --output tsv 2>health-apply-error.txt)"; then
    audit "failed health-apply deployment=$deployment; inspect Azure deployment operations"
    echo "::error::Private health job deployment failed; inspect Azure deployment operations."
    exit 1
  fi
  [[ "$state" == Succeeded ]] || { echo "::error::Private health job deployment did not succeed."; exit 1; }
  readback
  audit "health job deployed and validated; execution has not started"
fi
