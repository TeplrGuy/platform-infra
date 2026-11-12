const assert = require('node:assert/strict');
const test = require('node:test');
const { validate, validateAgainst } = require('../scripts/validate-foundation-preview');

const subscription = '8fcc5e8e-6540-4288-89e7-849e94290205';
const tenant = 'd11cdc76-c6f2-4368-a98f-498e78a7e011';
const deployer = 'b6a3c39d-0263-4f01-b975-654cdea443a0';
const root = `/subscriptions/${subscription}/resourceGroups/agtsdlc-dev-rg/providers`;
const registry = `${root}/Microsoft.ContainerRegistry/registries/cragentsdlcdev55eb`;
const vault = `${root}/Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb`;
const tags = {
  'app-onboard-session-id': '55eb0364-fed8-4fc9-95e3-405ad428b06d',
  'app-onboard-skill': 'true',
  'created-at': '2026-11-11T15:43:42.2240991-05:00',
  'deployed-by': 'github-actions',
  environment: 'agentsdlc-dev-55eb'
};

function preview() {
  const resources = [
    { id: registry, sku: { name: 'Basic' }, properties: { adminUserEnabled: false } },
    { id: vault, properties: {
      tenantId: tenant, sku: { name: 'standard' }, enableRbacAuthorization: true,
      enableSoftDelete: true, softDeleteRetentionInDays: 90,
      networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
    } },
    ...['portal', 'apigw', 'orders', 'inventory', 'notify'].map(name => ({
      id: `${root}/Microsoft.ManagedIdentity/userAssignedIdentities/ca-agentsdlc-dev-55eb-${name}-identity`
    }))
  ].map(resource => ({
    ...resource, name: resource.id.split('/').at(-1),
    type: resource.id === registry ? 'Microsoft.ContainerRegistry/registries'
      : resource.id === vault ? 'Microsoft.KeyVault/vaults' : 'Microsoft.ManagedIdentity/userAssignedIdentities',
    resourceGroup: 'agtsdlc-dev-rg', location: 'northeurope', tags: { ...tags }
  }));
  for (const [scope, id, role] of [
    [registry, '221ab1b6-b619-5181-a3ae-13e714ec1e42', '8311e382-0749-4cb8-b61a-304f252e45ec'],
    [vault, 'dac8d4ef-1356-5c48-822f-63aff5e58233', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7']
  ]) {
    resources.push({
      id: `${scope}/providers/Microsoft.Authorization/roleAssignments/${id}`,
      name: id, type: 'Microsoft.Authorization/roleAssignments', resourceGroup: 'agtsdlc-dev-rg',
      properties: { principalId: deployer, roleDefinitionId: `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions/${role}` }
    });
  }
  return { status: 'Succeeded', changes: resources.map(after => ({
    resourceId: after.id, changeType: 'Create', after
  })) };
}

test('accepts only the approved initial foundation scope and settings', () => {
  assert.doesNotThrow(() => validate(preview()));
  for (const mutate of [
    p => { p.status = 'Failed'; },
    p => { p.changes.pop(); },
    p => { p.changes[0].changeType = 'Unsupported'; },
    p => { p.changes[1].resourceId = p.changes[0].resourceId; },
    p => { p.changes[2].after.location = 'swedencentral'; },
    p => { p.changes[2].after.type = 'Microsoft.Compute/virtualMachines'; },
    p => { p.changes[0].after.properties.adminUserEnabled = true; },
    p => { p.changes[1].after.properties.enableRbacAuthorization = false; },
    p => { p.changes[7].after.properties.principalId = tenant; },
    p => { p.changes[8].after.properties.roleDefinitionId += '-other'; }
  ]) {
    const p = preview();
    mutate(p);
    assert.throws(() => validate(p));
  }
});

test('rejects configuration drift after approval, regardless of resource order', () => {
  const approved = preview();
  const recheck = preview();
  recheck.changes.reverse();
  assert.doesNotThrow(() => validateAgainst(recheck, approved));
  recheck.changes[0].after.apiVersion = 'unexpected';
  assert.throws(() => validateAgainst(recheck, approved), /changed after approval/);
});
