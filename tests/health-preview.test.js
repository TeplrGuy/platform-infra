const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { validate } = require('../scripts/health-preview');
const foundation = require('../infra/foundation.parameters.json').parameters;
const release = require('../infra/private-release.json');

const root = '/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/';
const domain = 'example-1234.northeurope.azurecontainerapps.io';
const source = readFileSync('scripts/private-health.js', 'utf8');
const identity = `${root}Microsoft.ManagedIdentity/userAssignedIdentities/${foundation.appNames.value[0]}-identity`;
const id = `${root}Microsoft.App/jobs/job-agentsdlc-dev-55eb-health`;
const envId = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb`;

function preview() {
  return { status: 'Succeeded', changes: [{ changeType: 'Create', resourceId: id, after: {
    id, type: 'Microsoft.App/jobs', location: 'northeurope', tags: foundation.tags.value,
    identity: { type: 'UserAssigned', userAssignedIdentities: { [identity]: {} } },
    properties: {
      environmentId: envId,
      configuration: { triggerType: 'Manual', replicaRetryLimit: 0, replicaTimeout: 600,
        manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 },
        registries: [{ identity, server: 'cragentsdlcdev55eb.azurecr.io' }] },
      template: { containers: [{
        name: 'private-health', image: `cragentsdlcdev55eb.azurecr.io/${release.services[0].name}@${release.services[0].digest}`,
        command: ['node', '-e', source], resources: { cpu: 0.5, memory: '1Gi' },
        env: [{ name: 'PRIVATE_HEALTH_RUN', value: 'true' }, { name: 'ACA_DOMAIN', value: domain }]
      }] }
    }
  } }] };
}

test('health preview permits only the scoped, read-only health job', () => {
  assert.doesNotThrow(() => validate(preview(), domain, source));
  for (const mutate of [
    p => { p.changes[0].changeType = 'Modify'; },
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
