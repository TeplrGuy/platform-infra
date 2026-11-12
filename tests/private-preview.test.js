const assert = require('node:assert/strict');
const test = require('node:test');
const { images, validate } = require('../scripts/private-preview');
const release = require('../infra/private-release.json');
const foundation = require('../infra/foundation.parameters.json').parameters;

const refs = Object.fromEntries(release.services.map(service => [service.refEnv, service.revision]));
const root = '/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/';
const domain = 'example-1234.northeurope.azurecontainerapps.io';
const names = foundation.appNames.value;

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
  assert.doesNotThrow(() => validate(preview(), domain, refs));
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
    assert.throws(() => validate(changed, domain, refs));
  }
});
