const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const release = require('../infra/private-release.json');
const foundation = require('../infra/foundation.parameters.json').parameters;

const root = '/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/';
const registry = 'cragentsdlcdev55eb.azurecr.io';
const environmentId = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb`;
const vaultSecret = 'https://kv-agentsdlc-dev-55eb.vault.azure.net/secrets/postgres-database-url';

function images(refs) {
  const keys = ['portal', 'apiGateway', 'orders', 'inventory', 'notifications'];
  const names = ['portal-web', 'api-gateway', 'orders-service', 'inventory-service', 'notifications-service'];
  const refNames = ['PORTAL_REF', 'GATEWAY_REF', 'ORDERS_REF', 'INVENTORY_REF', 'NOTIFICATIONS_REF'];
  if (release.publisherRun !== '43133264052' || release.services.length !== 5) throw Error('Image provenance is incomplete.');
  return Object.fromEntries(release.services.map((service, i) => {
    if (service.key !== keys[i] || service.name !== names[i] || service.refEnv !== refNames[i] ||
        !/^[a-f0-9]{40}$/.test(service.revision) || refs[service.refEnv] !== service.revision ||
        !/^sha256:[a-f0-9]{64}$/.test(service.digest)) {
      throw Error('Image provenance or source revision does not match the reviewed publisher run.');
    }
    return [service.key, `${registry}/${service.name}@${service.digest}`];
  }));
}

function validate(preview, domain, refs) {
  const expectedImages = images(refs);
  if (!/^[a-z0-9-]+\.northeurope\.azurecontainerapps\.io$/.test(domain)) throw Error('Unexpected environment domain.');
  if (preview?.status !== 'Succeeded' || !Array.isArray(preview.changes)) throw Error('Preview is incomplete.');
  const names = foundation.appNames.value;
  const expected = new Map(names.map((name, i) => [`${root}Microsoft.App/containerApps/${name}`.toLowerCase(), i]));
  const seen = new Set();
  const active = new Map();
  for (const change of preview.changes) {
    const id = change?.resourceId?.toLowerCase();
    if (!id || !id.startsWith(root.toLowerCase()) || seen.has(id)) throw Error('Duplicate or out-of-scope resource.');
    seen.add(id);
    if (change.changeType === 'Ignore') continue;
    if (!expected.has(id) || change.changeType !== 'Create' ||
        change.after?.id?.toLowerCase() !== id ||
        change.after?.type?.toLowerCase() !== 'microsoft.app/containerapps') {
      throw Error('Only creation of the five intended Container Apps is allowed.');
    }
    const i = expected.get(id);
    const app = change.after;
    const properties = app.properties;
    const identity = `${root}Microsoft.ManagedIdentity/userAssignedIdentities/${names[i]}-identity`;
    if (app.location !== 'northeurope' || properties?.managedEnvironmentId?.toLowerCase() !== environmentId.toLowerCase() ||
        app.identity?.type !== 'UserAssigned' ||
        !isDeepStrictEqual(Object.keys(app.identity.userAssignedIdentities || {}).map(x => x.toLowerCase()), [identity.toLowerCase()])) {
      throw Error('Application environment or identity differs from the plan.');
    }
    for (const [key, value] of Object.entries(foundation.tags.value)) {
      if (app.tags?.[key] !== value) throw Error('Application tags differ from the approved plan.');
    }
    const config = properties.configuration;
    if (config?.ingress?.external !== false || config.ingress.targetPort !== 3000 || config.ingress.transport !== 'auto' ||
        config.activeRevisionsMode !== 'Single' || config.registries?.length !== 1 ||
        config.registries[0].server !== registry ||
        config.registries[0].identity?.toLowerCase() !== identity.toLowerCase()) {
      throw Error('Ingress or registry identity is not private and scoped.');
    }
    const containers = properties.template?.containers;
    if (containers?.length !== 1 || containers[0].name !== release.services[i].name ||
        containers[0].image !== expectedImages[release.services[i].key] ||
        containers[0].resources?.cpu !== 0.5 || containers[0].resources?.memory !== '1Gi') {
      throw Error('Application image or resource sizing differs from the reviewed release.');
    }
    const vars = new Map((containers[0].env || []).map(item => [item.name, item]));
    if (vars.size !== (containers[0].env || []).length || vars.get('PORT')?.value !== '3000' ||
        vars.get('ENVIRONMENT_NAME')?.value !== 'agentsdlc-dev-55eb' ||
        vars.get('APPLICATIONINSIGHTS_CONNECTION_STRING')?.value !== '[REDACTED]' ||
        vars.get('OTEL_SERVICE_NAME')?.value !== release.services[i].name) {
      throw Error('Required application environment or telemetry is invalid.');
    }
    const urls = [
      { API_GATEWAY_URL: 1 },
      { ORDERS_SERVICE_URL: 2, INVENTORY_SERVICE_URL: 3 },
      { INVENTORY_SERVICE_URL: 3, NOTIFICATIONS_SERVICE_URL: 4 },
      {},
      {}
    ][i];
    for (const [key, target] of Object.entries(urls)) {
      if (vars.get(key)?.value !== `https://${names[target]}.internal.${domain}`) throw Error('Internal service URL differs from the plan.');
    }
    const db = i >= 2;
    const expectedVars = ['PORT', 'ENVIRONMENT_NAME', 'APPLICATIONINSIGHTS_CONNECTION_STRING', 'OTEL_SERVICE_NAME',
      ...Object.keys(urls), ...(db ? ['DATABASE_URL'] : [])].sort();
    if (!isDeepStrictEqual([...vars.keys()].sort(), expectedVars) ||
        properties.template.scale?.minReplicas !== 0 || properties.template.scale?.maxReplicas !== 3) {
      throw Error('Application environment or scaling differs from the plan.');
    }
    const secrets = config.secrets || [];
    if (db) {
      if (vars.get('DATABASE_URL')?.secretRef !== 'postgres-database-url' || secrets.length !== 1 ||
          secrets[0].name !== 'postgres-database-url' || secrets[0].keyVaultUrl !== vaultSecret ||
          secrets[0].identity?.toLowerCase() !== identity.toLowerCase()) throw Error('Database secret reference is invalid.');
    } else if (secrets.length || vars.has('DATABASE_URL')) {
      throw Error('Unexpected database secret access.');
    }
    const probes = containers[0].probes || [];
    if (probes.length !== 3 || !['Liveness', 'Readiness', 'Startup'].every(type =>
      probes.some(probe => probe.type === type && probe.httpGet?.path === '/health' && probe.httpGet.port === 3000))) {
      throw Error('Application health probes are incomplete.');
    }
    active.set(id, app);
  }
  if (active.size !== 5) throw Error('Preview does not include all five applications.');
}

if (require.main === module) {
  try {
    const [mode, file, domain] = process.argv.slice(2);
    if (mode === 'parameters') {
      console.log(JSON.stringify({ $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
        contentVersion: '1.0.0.0', parameters: { containerImages: { value: images(process.env) } } }, null, 2));
    } else if (mode === 'validate' && file && domain) {
      validate(JSON.parse(readFileSync(file, 'utf8')), domain, process.env);
      console.log('Private workload preview matches the pinned images and approved scope.');
    } else {
      throw Error('Usage: private-preview.js parameters | validate <file> <domain>');
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { images, validate };
