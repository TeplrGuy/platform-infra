#!/usr/bin/env bash
set -euo pipefail

mode="${1:?A runtime stage is required}"
readonly RUNTIME_POSTGRES_PASSWORD='Aa0_PreviewOnly_NotAnActualCredential7c770123456789'
if [[ "${GITHUB_ACTIONS:-}" != true || "${GITHUB_REPOSITORY:-}" != TeplrGuy/platform-infra ||
      "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ]]; then
  echo "::error::Runtime resource operations are restricted to the approved GitHub Actions workflow."
  exit 1
fi

audit() {
  printf '%s run=%s commit=%s\n' "$*" "$GITHUB_RUN_ID" "$GITHUB_SHA" | tee -a runtime-audit.log >&2
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

azure account account show --output json > runtime-account.json
node -e '
const a = require("./runtime-account.json");
if (a.id !== "b6f10878-9f8a-4b3f-8bc5-3464cdd79c77" ||
    a.tenantId !== "16b3c013-d300-468d-ac64-7eda0820b6d3" ||
    a.user?.type !== "servicePrincipal") throw Error("The runtime identity does not match the approved OIDC target.");'
location="$(azure resource-group group show --name agtsdlc-dev-rg --query location --output tsv)"
[[ "$location" == northeurope ]] || { echo "::error::The resource-group region changed."; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo "::error::The checkout is not the workflow revision."; exit 1; }

credential_state() {
  local count
  count="$(azure credential-resource resource list \
    --resource-group agtsdlc-dev-rg \
    --resource-type Microsoft.KeyVault/vaults/secrets \
    --query "[?name=='kv-agentsdlc-dev-7c77/postgres-admin-password'] | length(@)" \
    --output tsv)"
  if [[ "$count" == "1" ]]; then
    echo "exists"
  else
    echo "missing"
  fi
}

require_new_database() {
  local existing
  existing="$(azure database-discovery postgres flexible-server list --resource-group agtsdlc-dev-rg \
    --query "[?name=='pg-agentsdlc-dev-7c77'].name" --output tsv)"
  [[ -z "$existing" ]] || {
    echo "::error::The database exists without its recorded administrator credential. Refusing to generate or reset it."
    exit 1
  }
}

load_password() {
  POSTGRES_ADMIN_PASSWORD="$RUNTIME_POSTGRES_PASSWORD"
  export POSTGRES_ADMIN_PASSWORD
}

ensure_postgres_ready() {
  local state
  state="$(azure server-state postgres flexible-server show \
    --resource-group agtsdlc-dev-rg \
    --name pg-agentsdlc-dev-7c77 \
    --query state \
    --output tsv)"
  case "$state" in
    Ready)
      return 0
      ;;
    Stopped)
      azure server-start postgres flexible-server start \
        --resource-group agtsdlc-dev-rg \
        --name pg-agentsdlc-dev-7c77 \
        --output none
      ;;
    *)
      echo "::error::Unexpected PostgreSQL server state: $state"
      exit 1
      ;;
  esac
  for _ in {1..30}; do
    state="$(azure server-poll postgres flexible-server show \
      --resource-group agtsdlc-dev-rg \
      --name pg-agentsdlc-dev-7c77 \
      --query state \
      --output tsv)"
    [[ "$state" == Ready ]] && return 0
    sleep 10
  done
  echo "::error::PostgreSQL server did not reach Ready state after start."
  exit 1
}

preview() {
  local stage="$1" template="$2" validate_stage="${3:-$1}"
  azure "$stage-what-if" deployment group what-if \
    --name "runtime-$stage-preview-$GITHUB_RUN_ID" --resource-group agtsdlc-dev-rg \
    --parameters "$template" --no-pretty-print --no-prompt --output json |
    node scripts/runtime-preview.js sanitize > runtime-what-if.json
  node scripts/runtime-preview.js "$validate_stage" runtime-what-if.json
  git ls-files -z infra scripts/runtime-stage.sh scripts/runtime-preview.js | xargs -0 sha256sum > runtime-template.sha256
}

secrets_change_type() {
  node -e '
const fs = require("node:fs");
const p = JSON.parse(fs.readFileSync("runtime-what-if.json", "utf8"));
const root = "/subscriptions/b6f10878-9f8a-4b3f-8bc5-3464cdd79c77/resourceGroups/agtsdlc-dev-rg/providers/microsoft.keyvault/vaults/kv-agentsdlc-dev-7c77/secrets/postgres-admin-password";
const c = (p.changes || []).find(x => (x.resourceId || "").toLowerCase() === root);
process.stdout.write(c?.changeType || "NoChange");
'
}

apply() {
  local stage="$1" template="$2"
  sha256sum --check "approved-runtime/runtime-template.sha256"
  node scripts/runtime-preview.js "$stage" runtime-what-if.json approved-runtime/runtime-what-if.json
  local state
  state="$(azure "$stage-apply" deployment group create \
    --name "runtime-$stage-$GITHUB_RUN_ID" --resource-group agtsdlc-dev-rg \
    --parameters "$template" --query properties.provisioningState --output tsv)"
  [[ "$state" == Succeeded ]] || { echo "::error::The runtime deployment did not succeed."; exit 1; }
}

case "$mode" in
  secrets-preview)
    if [[ "$(credential_state)" == exists ]]; then
      echo "seed_required=false" >> "$GITHUB_OUTPUT"
      audit "credential-reuse no credential change requested"
    else
      require_new_database
      export POSTGRES_ADMIN_PASSWORD="$RUNTIME_POSTGRES_PASSWORD"
      preview secrets infra/runtime-secrets.bicepparam secrets-check
      change_type="$(secrets_change_type)"
      case "$change_type" in
        Create)
          require_new_database
          echo "seed_required=true" >> "$GITHUB_OUTPUT"
          ;;
        Modify|NoChange)
          echo "seed_required=false" >> "$GITHUB_OUTPUT"
          audit "credential-reuse no credential change requested"
          ;;
        *)
          echo "::error::Unexpected runtime secret change type: $change_type"
          exit 1
          ;;
      esac
    fi
    ;;
  secrets-apply)
    credential_status="$(credential_state)"
    if [[ "$credential_status" == exists ]]; then
      audit "credential-reuse seed step skipped because database already exists"
      exit 0
    fi
    [[ "$credential_status" == missing ]] || { echo "::error::Credential state changed after approval."; exit 1; }
    require_new_database
    export POSTGRES_ADMIN_PASSWORD="$RUNTIME_POSTGRES_PASSWORD"
    preview secrets infra/runtime-secrets.bicepparam
    sha256sum --check approved-runtime/runtime-template.sha256
    node scripts/runtime-preview.js secrets runtime-what-if.json approved-runtime/runtime-what-if.json
    apply secrets infra/runtime-secrets.bicepparam
    [[ "$(credential_state)" == exists ]] || { echo "::error::The credential was not persisted in Key Vault resource state."; exit 1; }
    ;;
  core-preview|core-apply)
    load_password
    ensure_postgres_ready
    preview core infra/runtime-foundation.bicepparam
    if [[ "$mode" == core-apply ]]; then
      apply core infra/runtime-foundation.bicepparam
      azure runtime-outputs deployment group show --name "runtime-core-$GITHUB_RUN_ID" \
        --resource-group agtsdlc-dev-rg --query properties.outputs --output json > runtime-outputs.json
    fi
    ;;
  recovery-preview|recovery-apply)
    load_password
    ensure_postgres_ready
    azure server-discovery postgres flexible-server show --resource-group agtsdlc-dev-rg \
      --name pg-agentsdlc-dev-7c77 --query '{state:state,administratorLogin:administratorLogin,version:version}' --output json |
      node -e 'let s=""; process.stdin.on("data", c => s+=c).on("end", () => {
        const p=JSON.parse(s);
        if (p.state !== "Ready" || p.administratorLogin !== "agenticsadmin" || p.version !== "16")
          throw Error("Existing PostgreSQL state, administrator, or version is unexpected.");
      });'
    preview recovery infra/runtime-recovery.bicepparam
    if [[ "$mode" == recovery-apply ]]; then
      apply recovery infra/runtime-recovery.bicepparam
    fi
    ;;
  *)
    echo "::error::Unknown runtime stage."
    exit 1
    ;;
esac
unset POSTGRES_ADMIN_PASSWORD
