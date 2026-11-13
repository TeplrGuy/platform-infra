const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { images, validate, validateAgainst } = require('../scripts/private-preview');
const release = require('../infra/private-release.json');
const foundation = require('../infra/foundation.parameters.json').parameters;

const refs = Object.fromEntries(release.services.map(service => [service.refEnv, service.revision]));
const root = '/subscriptions/b6f10878-9f8a-4b3f-8bc5-3464cdd79c77/resourceGroups/agtsdlc-dev-rg/providers/';
const domain = 'example-1234.northeurope.azurecontainerapps.io';
const names = foundation.appNames.value;
const build = process.platform === 'win32'
  ? spawnSync('az bicep build --file infra/private-workloads.bicep --stdout', { shell: true, encoding: 'utf8' })
  : spawnSync('az', ['bicep', 'build', '--file', 'infra/private-workloads.bicep', '--stdout'], { encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr || build.error?.message);
const template = JSON.parse(build.stdout);
const check = p => validate(p, domain, refs, template);

function preview() {
  const imageMap = images(refs);
  return { status: 'Succeeded', changes: release.services.map((service, i) => {
    const identity = `${root}Microsoft.ManagedIdentity/userAssignedIdentities/${names[i]}-identity`;
    const id = `${root}Microsoft.App/containerApps/${names[i]}`;
    const urls = [{ API_GATEWAY_URL: 1 }, { ORDERS_SERVICE_URL: 2, INVENTORY_SERVICE_URL: 3 },
      { INVENTORY_SERVICE_URL: 3, NOTIFICATIONS_SERVICE_URL: 4 }, {}, {}][i];
    const env = [
      { name: 'PORT', value: '3000' },
      { name: 'ENVIRONMENT_NAME', value: 'agentsdlc-dev-7c77' },
      { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: '[REDACTED]' },
      { name: 'OTEL_SERVICE_NAME', value: service.name },
      ...Object.entries(urls).map(([name, target]) => ({ name, value: `https://${names[target]}.internal.${domain}` })),
      ...(i >= 2 ? [{ name: 'DATABASE_URL', secretRef: 'postgres-database-url' }] : [])
    ];
    const secrets = i >= 2 ? [{ name: 'postgres-database-url', value: '*******' }] : [];
    return { changeType: 'Create', resourceId: id, after: {
      id, type: 'Microsoft.App/containerApps', location: 'northeurope', tags: foundation.tags.value,
      identity: { type: 'UserAssigned', userAssignedIdentities: { [identity]: {} } },
      properties: {
        managedEnvironmentId: `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-7c77`,
        configuration: { activeRevisionsMode: 'Single', ingress: { external: false, targetPort: 3000, transport: 'auto' },
          registries: [{ server: 'cragentsdlcdev7c77.azurecr.io', identity }], secrets },
        template: { scale: { minReplicas: 0, maxReplicas: 3 }, containers: [{
          name: service.name, image: imageMap[service.key], resources: { cpu: 0.5, memory: '1Gi' }, env,
          probes: ['Liveness', 'Readiness', 'Startup'].map(type => ({ type, httpGet: { path: '/health', port: 3000 } }))
        }] }
      }
    } };
  }) };
}

test('private preview requires pinned source revisions and five private applications', () => {
  assert.doesNotThrow(() => check(preview()));
  assert.throws(() => images({ ...refs, PORTAL_REF: '0'.repeat(40) }), /provenance/);
  for (const mutate of [
    p => { p.changes.pop(); },
    p => { p.changes[0].changeType = 'Delete'; },
    p => { p.changes[0].after.properties.configuration.ingress.external = true; },
    p => { p.changes[1].after.properties.template.containers[0].image += ':latest'; },
    p => { p.changes[2].after.properties.configuration.secrets[0].identity = 'wrong'; },
    p => { p.changes[2].after.properties.template.containers[0].env.find(e => e.name === 'INVENTORY_SERVICE_URL').value = 'http://localhost'; },
    p => { p.changes[4].after.properties.template.containers[0].env.push({ name: 'UNREVIEWED', value: 'true' }); }
  ]) {
    const changed = preview();
    mutate(changed);
    assert.throws(() => check(changed));
  }
});

test('masked secret names require the exact compiled bindings', () => {
  const p = preview();
  for (const change of p.changes.slice(2)) {
    change.after.properties.configuration.secrets[0].name = '*******';
    change.after.properties.template.containers[0].env.find(e => e.name === 'DATABASE_URL').secretRef = '*******';
  }
  assert.doesNotThrow(() => check(p));
  const altered = structuredClone(template);
  const nested = Object.values(altered.resources)[0].properties.template;
  nested.variables.databaseUrlSecret = 'other-secret';
  assert.throws(() => validate(p, domain, refs, altered), /compiled secret/i);
  const alteredExpression = structuredClone(template);
  const app = Object.values(Object.values(alteredExpression.resources)[0].properties.template.resources)
    .find(resource => resource.type === 'Microsoft.App/containerApps');
  app.properties.configuration.secrets += ' ';
  assert.throws(() => validate(p, domain, refs, alteredExpression), /compiled secret/i);
  assert.throws(() => validate(p, domain, refs, undefined), /compiled secret/i);
});

test('Azure unresolved references are accepted only for the approved resources', () => {
  const p = preview();
  const envId = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-7c77`;
  const registryId = `${root}Microsoft.ContainerRegistry/registries/cragentsdlcdev7c77`;
  for (const change of p.changes) {
    const config = change.after.properties.configuration;
    config.registries[0].server = `[reference('${registryId}', '2025-11-01').loginServer]`;
    for (const entry of change.after.properties.template.containers[0].env) {
      if (entry.name.endsWith('_URL') && entry.name !== 'DATABASE_URL') {
        const target = names.find(name => entry.value.startsWith(`https://${name}.internal.`));
        entry.value = `[concat('https://', '${target}', '.internal.', reference('${envId}', '2026-07-01').defaultDomain)]`;
      }
    }
    if (config.secrets.length) config.secrets[0].value = '*******';
  }
  assert.doesNotThrow(() => check(p));
  p.changes[2].after.properties.configuration.secrets[0].keyVaultUrl =
    'https://kv-agentsdlc-dev-7c77.vault.azure.net/secrets/postgres-database-url';
  assert.throws(() => check(p), /secret reference/i);
});

test('promotion recheck rejects drift even in otherwise valid properties', () => {
  const approved = preview();
  const current = structuredClone(approved);
  current.changes.reverse();
  assert.doesNotThrow(() => validateAgainst(current, approved, domain, refs, template));
  current.changes[0].after.properties.template.containers[0].probes[0].initialDelaySeconds = 99;
  assert.doesNotThrow(() => check(current));
  assert.throws(() => validateAgainst(current, approved, domain, refs, template), /changed after approval/i);
});

test('protected apply rechecks the approved preview before any Azure write', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'private-apply-test-'));
  try {
    const rootDir = path.resolve(__dirname, '..');
    cpSync(path.join(rootDir, 'infra'), path.join(tmp, 'infra'), { recursive: true });
    cpSync(path.join(rootDir, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
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
  printf '%s\\0' scripts/private-preview.sh scripts/private-preview.js scripts/runtime-preview.js
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
      */registries/*) echo cragentsdlcdev7c77.azurecr.io ;;
      */vaults/*) echo https://kv-agentsdlc-dev-7c77.vault.azure.net/ ;;
      */containerApps/*) cat "$TEST_LIVE_DIR/\${4##*/}.json" ;;
      *) exit 1 ;;
    esac ;;
  'bicep build --file') cat "$TEST_TEMPLATE" ;;
  'deployment group what-if') cat "$TEST_PREVIEW" ;;
  'deployment group create') touch "$TEST_WRITTEN"; echo Succeeded ;;
  *) echo "Unexpected Azure command" >&2; exit 1 ;;
esac
`);
    const unix = p => {
      if (process.platform !== 'win32') return p;
      const result = spawnSync('bash', ['-c', 'cygpath -u "$1"', '_', p], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const templateFile = path.join(tmp, 'compiled-fixture.json');
    const previewFile = path.join(tmp, 'what-if-fixture.json');
    const written = path.join(tmp, 'azure-write');
    const liveDir = path.join(tmp, 'live');
    mkdirSync(liveDir);
    writeFileSync(templateFile, JSON.stringify(template));
    const baseline = preview();
    writeFileSync(previewFile, JSON.stringify(baseline));
    for (const change of baseline.changes) {
      const name = change.resourceId.split('/').at(-1);
      writeFileSync(path.join(liveDir, `${name}.json`), JSON.stringify({ state: 'Succeeded', external: false,
        image: change.after.properties.template.containers[0].image }));
    }
    const env = { ...process.env, ...refs, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'TeplrGuy/platform-infra',
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '123', GITHUB_SHA: 'a'.repeat(40),
      TEST_DOMAIN: domain, TEST_TEMPLATE: unix(templateFile), TEST_PREVIEW: unix(previewFile),
      TEST_WRITTEN: unix(written), TEST_BIN: unix(bin), TEST_ROOT: unix(tmp), TEST_LIVE_DIR: unix(liveDir) };
    const run = mode => spawnSync('bash', ['-c',
      'export PATH="$TEST_BIN:$PATH"; cd "$TEST_ROOT"; bash scripts/private-preview.sh "$1"', '_', mode],
    { env, encoding: 'utf8' });
    const first = run('preview');
    assert.equal(first.status, 0, first.stderr);
    const approved = path.join(tmp, 'approved-private');
    mkdirSync(approved);
    for (const file of ['private-domain.txt', 'private-parameters.json', 'private-template.sha256', 'private-what-if.json']) {
      cpSync(path.join(tmp, file), path.join(approved, file));
    }
    const drift = structuredClone(baseline);
    drift.changes[0].after.properties.template.containers[0].probes[0].initialDelaySeconds = 99;
    writeFileSync(previewFile, JSON.stringify(drift));
    const rejected = run('apply');
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /changed after approval/i);
    assert.equal(existsSync(written), false);
    writeFileSync(previewFile, JSON.stringify(baseline));
    const approvedParameters = path.join(approved, 'private-parameters.json');
    const savedParameters = readFileSync(approvedParameters);
    writeFileSync(approvedParameters, '{}');
    const changedParameters = run('apply');
    assert.notEqual(changedParameters.status, 0);
    assert.match(changedParameters.stdout + changedParameters.stderr, /parameters changed/i);
    assert.equal(existsSync(written), false);
    writeFileSync(approvedParameters, savedParameters);
    const accepted = run('apply');
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(existsSync(written), true);
    const appFile = path.join(liveDir, `${names[0]}.json`);
    const liveApp = JSON.parse(readFileSync(appFile, 'utf8'));
    liveApp.external = true;
    writeFileSync(appFile, JSON.stringify(liveApp));
    const unsafeRuntime = run('apply');
    assert.notEqual(unsafeRuntime.status, 0);
    assert.match(unsafeRuntime.stderr, /ingress, or image differs/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
