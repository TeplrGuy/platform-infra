const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { images, validate } = require('../scripts/private-preview');
const release = require('../infra/private-release.json');
const foundation = require('../infra/foundation.parameters.json').parameters;

const refs = Object.fromEntries(release.services.map(service => [service.refEnv, service.revision]));
const root = '/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/';
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
      { name: 'ENVIRONMENT_NAME', value: 'agentsdlc-dev-55eb' },
      { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: '[REDACTED]' },
      { name: 'OTEL_SERVICE_NAME', value: service.name },
      ...Object.entries(urls).map(([name, target]) => ({ name, value: `https://${names[target]}.internal.${domain}` })),
      ...(i >= 2 ? [{ name: 'DATABASE_URL', secretRef: 'postgres-database-url' }] : [])
    ];
    const secrets = i >= 2 ? [{ name: 'postgres-database-url',
      keyVaultUrl: 'https://kv-agentsdlc-dev-55eb.vault.azure.net/secrets/postgres-database-url', identity }] : [];
    return { changeType: 'Create', resourceId: id, after: {
      id, type: 'Microsoft.App/containerApps', location: 'northeurope', tags: foundation.tags.value,
      identity: { type: 'UserAssigned', userAssignedIdentities: { [identity]: {} } },
      properties: {
        managedEnvironmentId: `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb`,
        configuration: { activeRevisionsMode: 'Single', ingress: { external: false, targetPort: 3000, transport: 'auto' },
          registries: [{ server: 'cragentsdlcdev55eb.azurecr.io', identity }], secrets },
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
    p => { p.changes[0].changeType = 'Modify'; },
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
  const envId = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb`;
  const vaultId = `${root}Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb`;
  const registryId = `${root}Microsoft.ContainerRegistry/registries/cragentsdlcdev55eb`;
  for (const change of p.changes) {
    const config = change.after.properties.configuration;
    config.registries[0].server = `[reference('${registryId}', '2025-11-01').loginServer]`;
    for (const entry of change.after.properties.template.containers[0].env) {
      if (entry.name.endsWith('_URL') && entry.name !== 'DATABASE_URL') {
        const target = names.find(name => entry.value.startsWith(`https://${name}.internal.`));
        entry.value = `[concat('https://', '${target}', '.internal.', reference('${envId}', '2026-07-01').defaultDomain)]`;
      }
    }
    if (config.secrets.length) {
      config.secrets[0].keyVaultUrl = `[concat(reference('${vaultId}', '2026-05-15').vaultUri, 'secrets/', 'postgres-database-url')]`;
    }
  }
  assert.doesNotThrow(() => check(p));
  p.changes[2].after.properties.configuration.secrets[0].keyVaultUrl =
    `[concat(reference('${vaultId}-other', '2026-05-15').vaultUri, 'secrets/', 'postgres-database-url')]`;
  assert.throws(() => check(p), /secret reference/i);
});
