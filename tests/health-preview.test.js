const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validate } = require('../scripts/health-preview');
const foundation = require('../infra/foundation.parameters.json').parameters;
const release = require('../infra/private-release.json');

const root = '/subscriptions/b6f10878-9f8a-4b3f-8bc5-3464cdd79c77/resourceGroups/agtsdlc-dev-rg/providers/';
const domain = 'example-1234.northeurope.azurecontainerapps.io';
const source = readFileSync('scripts/private-health.js', 'utf8');
const identity = `${root}Microsoft.ManagedIdentity/userAssignedIdentities/${foundation.appNames.value[0]}-identity`;
const id = `${root}Microsoft.App/jobs/job-agentsdlc-dev-7c77-health`;
const envId = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-7c77`;

function preview() {
  return { status: 'Succeeded', changes: [{ changeType: 'Create', resourceId: id, after: {
    id, type: 'Microsoft.App/jobs', location: 'northeurope', tags: foundation.tags.value,
    identity: { type: 'UserAssigned', userAssignedIdentities: { [identity]: {} } },
    properties: {
      environmentId: envId,
      configuration: { triggerType: 'Manual', replicaRetryLimit: 0, replicaTimeout: 600,
        manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 },
        registries: [{ identity, server: 'cragentsdlcdev7c77.azurecr.io' }] },
      template: { containers: [{
        name: 'private-health', image: `cragentsdlcdev7c77.azurecr.io/${release.services[0].name}@${release.services[0].digest}`,
        command: ['node', '-e', source], resources: { cpu: 0.5, memory: '1Gi' },
        env: [{ name: 'PRIVATE_HEALTH_RUN', value: 'true' }, { name: 'ACA_DOMAIN', value: domain }]
      }] }
    }
  } }] };
}

test('health preview permits only the scoped, read-only health job', () => {
  assert.doesNotThrow(() => validate(preview(), domain, source));
  const modified = preview();
  modified.changes[0].changeType = 'Modify';
  assert.doesNotThrow(() => validate(modified, domain, source));
  for (const mutate of [
    p => { p.changes[0].changeType = 'Delete'; },
    p => { p.changes[0].after.identity.type = 'SystemAssigned'; },
    p => { p.changes[0].after.properties.template.containers[0].command[2] += 'changed'; },
    p => { p.changes[0].after.properties.template.containers[0].env[1].value = 'attacker.example'; },
    p => { p.changes[0].after.properties.template.containers[0].env[1].secretRef = 'secret'; },
    p => { p.changes[0].after.properties.template.initContainers = [{ name: 'unexpected' }]; },
    p => { p.changes[0].after.properties.configuration.secrets = [{ name: 'unexpected' }]; }
  ]) {
    const changed = preview();
    mutate(changed);
    assert.throws(() => validate(changed, domain, source));
  }
});

test('health job creation rechecks the approved what-if before any Azure write', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'health-apply-test-'));
  try {
    cpSync(path.resolve('infra'), path.join(tmp, 'infra'), { recursive: true });
    cpSync(path.resolve('scripts'), path.join(tmp, 'scripts'), { recursive: true });
    const bin = path.join(tmp, 'bin');
    mkdirSync(bin);
    const executable = (name, content) => {
      const file = path.join(bin, name);
      writeFileSync(file, content);
      chmodSync(file, 0o755);
    };
    executable('git', `#!/usr/bin/env bash
if [[ "$1" == rev-parse ]]; then echo "$GITHUB_SHA"; else
  find infra -type f -print0
  printf '%s\\0' scripts/private-health.js scripts/health-preview.js scripts/health-stage.sh scripts/runtime-preview.js
fi
`);
    executable('jq', `#!/usr/bin/env node
let s=''; process.stdin.on('data', x => s += x).on('end', () => {
  const p = JSON.parse(s);
  console.log(process.argv.at(-1) === '.state' ? p.state : p.domain);
});
`);
    executable('az', `#!/usr/bin/env bash
case "$1 $2 $3" in
  'account show --output') echo '{"id":"b6f10878-9f8a-4b3f-8bc5-3464cdd79c77","tenantId":"16b3c013-d300-468d-ac64-7eda0820b6d3","user":{"name":"8148728e-6852-4c3a-91dd-9e3bc87c565e","type":"servicePrincipal"}}' ;;
  'group show --name') echo northeurope ;;
  'resource show --ids')
    case "$4" in
      */managedEnvironments/*) printf '{"state":"Succeeded","domain":"%s"}\\n' "$TEST_DOMAIN" ;;
      */jobs/*) cat "$TEST_LIVE" ;;
      *) exit 1 ;;
    esac ;;
  'bicep build --file') echo '{}' ;;
  'deployment group what-if') cat "$TEST_PREVIEW" ;;
  'deployment group create') touch "$TEST_WRITTEN"; echo Succeeded ;;
  'containerapp job start') touch "$TEST_STARTED"; echo job-agentsdlc-dev-7c77-health-ab123 ;;
  'containerapp job execution') echo "\${TEST_STATUS:-Succeeded}" ;;
  *) echo "Unexpected Azure command" >&2; exit 1 ;;
esac
`);
    const unix = p => {
      if (process.platform !== 'win32') return p;
      const result = spawnSync('bash', ['-c', 'cygpath -u "$1"', '_', p], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const previewFile = path.join(tmp, 'what-if-fixture.json');
    const liveFile = path.join(tmp, 'live-fixture.json');
    const written = path.join(tmp, 'azure-write');
    const started = path.join(tmp, 'job-started');
    const baseline = preview();
    writeFileSync(previewFile, JSON.stringify(baseline));
    const live = structuredClone(baseline.changes[0].after);
    live.properties.provisioningState = 'Succeeded';
    live.location = 'North Europe';
    writeFileSync(liveFile, JSON.stringify(live));
    const env = { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'TeplrGuy/platform-infra',
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '123', GITHUB_SHA: 'a'.repeat(40),
      TEST_DOMAIN: domain, TEST_PREVIEW: unix(previewFile), TEST_LIVE: unix(liveFile),
      TEST_WRITTEN: unix(written), TEST_STARTED: unix(started), TEST_BIN: unix(bin), TEST_ROOT: unix(tmp) };
    const run = (mode, extra = {}) => spawnSync('bash', ['-c',
      'export PATH="$TEST_BIN:$PATH"; cd "$TEST_ROOT"; bash scripts/health-stage.sh "$1"', '_', mode],
    { env: { ...env, ...extra }, encoding: 'utf8' });
    const first = run('preview');
    assert.equal(first.status, 0, first.stderr);
    const approved = path.join(tmp, 'approved-health');
    mkdirSync(approved);
    for (const file of ['health-domain.txt', 'health-template.sha256', 'health-what-if.json']) {
      cpSync(path.join(tmp, file), path.join(approved, file));
    }
    const drift = structuredClone(baseline);
    drift.changes[0].after.properties.template.containers[0].resources.ephemeralStorage = '2Gi';
    writeFileSync(previewFile, JSON.stringify(drift));
    const rejected = run('apply');
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /changed after approval/i);
    assert.equal(existsSync(written), false);
    writeFileSync(previewFile, JSON.stringify(baseline));
    const accepted = run('apply');
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(existsSync(written), true);
    const unsafe = structuredClone(live);
    unsafe.properties.template.containers[0].image = 'unreviewed';
    writeFileSync(liveFile, JSON.stringify(unsafe));
    const rejectedRun = run('run');
    assert.notEqual(rejectedRun.status, 0);
    assert.equal(existsSync(started), false);
    writeFileSync(liveFile, JSON.stringify(live));
    const acceptedRun = run('run');
    assert.equal(acceptedRun.status, 0, acceptedRun.stderr);
    assert.equal(existsSync(started), true);
    const failedRun = run('run', { TEST_STATUS: 'Failed' });
    assert.notEqual(failedRun.status, 0);
    assert.match(failedRun.stdout + failedRun.stderr, /ended with status Failed/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
