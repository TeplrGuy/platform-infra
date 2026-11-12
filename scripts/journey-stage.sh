#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_RUN_ATTEMPT:-}" == 1 && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] ||
  { echo "::error::A journey must be a fresh workflow run; reconcile any prior attempt before another run."; exit 1; }
bash scripts/health-stage.sh verify
domain="$(cat health-domain.txt)"
order="demo-$GITHUB_RUN_ID"
scope="/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers"
job="$scope/Microsoft.App/jobs/job-agentsdlc-dev-55eb-health"
audit() { printf '%s run=%s commit=%s\n' "$*" "$GITHUB_RUN_ID" "$GITHUB_SHA" | tee -a journey-audit.log >&2; }
azure() {
  local label="$1"; shift
  audit "started $label"
  if az "$@"; then audit "succeeded $label"; else
    local code=$?
    audit "failed $label exit=$code"
    return "$code"
  fi
}
check_apps() {
  local key actual
  for key in portal apigw orders inventory notify; do
    actual="$(azure "app-$key" containerapp show --name "ca-agentsdlc-dev-55eb-$key" \
      --resource-group agtsdlc-dev-rg \
      --query '{image:properties.template.containers[0].image,external:properties.configuration.ingress.external,state:properties.provisioningState}' --output json)"
    node - "$key" "$actual" <<'NODE'
const release = require('./infra/private-release.json');
const [key, json] = process.argv.slice(2);
const app = JSON.parse(json);
const names = { portal: 'portal', apigw: 'apiGateway', orders: 'orders', inventory: 'inventory', notify: 'notifications' };
const service = release.services.find(item => item.key === names[key]);
if (!service || process.env[service.refEnv] !== service.revision ||
    app.image !== `cragentsdlcdev55eb.azurecr.io/${service.name}@${service.digest}` ||
    app.external !== false || app.state !== 'Succeeded') {
  throw Error(`Pinned private application validation failed: ${key}`);
}
NODE
  done
}
run_journey() {
  local mode="$1" execution status
  node - "$domain" "$order" "$mode" <<'NODE'
const fs = require('node:fs');
const [domain, order, mode] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync('health-live.json', 'utf8'));
const image = job.properties.template.containers[0].image;
const source = fs.readFileSync('scripts/private-journey.js', 'utf8');
const body = { containers: [{
  name: 'private-health', image, command: ['node', '-e', source],
  resources: { cpu: 0.5, memory: '1Gi' },
  env: [
    { name: 'PRIVATE_JOURNEY_RUN', value: 'true' },
    { name: 'ACA_DOMAIN', value: domain },
    { name: 'ORDER_ID', value: order },
    { name: 'JOURNEY_MODE', value: mode }
  ]
}] };
fs.writeFileSync('journey-request.json', JSON.stringify(body));
NODE
  execution="$(azure "journey-start-$mode" rest --method post \
    --url "https://management.azure.com$job/start?api-version=2026-01-01" \
    --headers 'Content-Type=application/json' --body @journey-request.json --query name --output tsv)"
  [[ "$execution" =~ ^job-agentsdlc-dev-55eb-health-[a-z0-9]+$ ]] ||
    { echo "::error::Unexpected journey execution ID; reconcile before retrying."; exit 1; }
  printf '%s %s %s\n' "$mode" "$order" "$execution" | tee -a journey-executions.txt
  for ((attempt=0; attempt<72; attempt++)); do
    status="$(azure "journey-status-$mode" containerapp job execution show --name job-agentsdlc-dev-55eb-health \
      --resource-group agtsdlc-dev-rg --job-execution-name "$execution" --query properties.status --output tsv)"
    case "$status" in
      Succeeded) audit "journey execution succeeded mode=$mode order=$order execution=$execution"; return 0 ;;
      Failed|Stopped) echo "::error::Journey $mode $execution ended $status; reconcile $order before retrying."; exit 1 ;;
      Running|Processing|Pending) sleep 10 ;;
      *) echo "::error::Unexpected journey status $status; reconcile $order before retrying."; exit 1 ;;
    esac
  done
  echo "::error::Journey timed out; reconcile $order before retrying."
  exit 1
}

check_apps
revision="$(azure order-revision containerapp show --name ca-agentsdlc-dev-55eb-orders \
  --resource-group agtsdlc-dev-rg --query properties.latestReadyRevisionName --output tsv)"
[[ "$revision" =~ ^ca-agentsdlc-dev-55eb-orders--[a-z0-9]+$ ]] ||
  { echo "::error::Unexpected orders revision."; exit 1; }
run_journey create
seen_running=false
for ((attempt=0; attempt<60; attempt++)); do
  current="$(azure order-revision containerapp show --name ca-agentsdlc-dev-55eb-orders \
    --resource-group agtsdlc-dev-rg --query properties.latestReadyRevisionName --output tsv)"
  [[ "$current" == "$revision" ]] || { echo "::error::Orders revision changed during durability check."; exit 1; }
  replicas="$(azure order-replicas containerapp replica list --name ca-agentsdlc-dev-55eb-orders \
    --resource-group agtsdlc-dev-rg --revision "$revision" --output json)"
  state="$(node -e '
    const r = JSON.parse(process.argv[1]);
    if (!Array.isArray(r) || r.some(x => !["Running", "NotRunning"].includes(x.properties?.runningState))) process.exit(1);
    console.log(r.some(x => x.properties.runningState === "Running") ? "running" : "zero");
  ' "$replicas")"
  if [[ "$state" == running ]]; then seen_running=true; fi
  if [[ "$seen_running" == true && "$state" == zero ]]; then
    audit "orders scaled to zero revision=$revision order=$order"
    check_apps
    run_journey verify
    audit "durability verified after scale-to-zero order=$order"
    exit 0
  fi
  sleep 15
done
echo "::error::Did not observe orders running then scaling to zero; durability not verified for $order."
exit 1
