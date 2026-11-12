#!/usr/bin/env bash
set -euo pipefail

if [[ ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]; then
  echo "GITHUB_RUN_ID must identify the run that built the images." >&2
  exit 1
fi

containers=()
cleanup() {
  for container in "${containers[@]}"; do
    docker rm --force "$container" >/dev/null
  done
}
trap cleanup EXIT

for repo in portal-web api-gateway orders-service inventory-service notifications-service; do
  container="$(docker run --detach \
    --publish 127.0.0.1::3000 \
    --add-host host.docker.internal:host-gateway \
    --env ENVIRONMENT_NAME=local \
    --env DATABASE_URL=postgresql://sdlctest:local-test-only@host.docker.internal:5432/sdlc_test \
    "local-gate/$repo:$GITHUB_RUN_ID")"
  containers+=("$container")
  address="$(docker port "$container" 3000/tcp)"
  healthy=false
  for attempt in {1..30}; do
    if curl --fail --silent --show-error --max-time 2 "http://$address/health" >/dev/null 2>&1; then
      healthy=true
      break
    fi
    sleep 1
  done
  if [[ "$healthy" != true ]]; then
    echo "::error::$repo container did not become healthy."
    docker logs "$container"
    exit 1
  fi
  echo "$repo container passed its health check."
done
