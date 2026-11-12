const assert = require('node:assert/strict');
const test = require('node:test');
const { validate, validateAgainst } = require('../scripts/validate-foundation-preview');

const subscription = 'b6f10878-9f8a-4b3f-8bc5-3464cdd79c77';
const tenant = '16b3c013-d300-468d-ac64-7eda0820b6d3';
const deployer = '68b48a36-c15b-4e51-a9a5-f26e6b6a342b';
const root = `/subscriptions/${subscription}/resourceGroups/agtsdlc-dev-rg/providers`;
const registry = `${root}/Microsoft.ContainerRegistry/registries/cragentsdlcdev7c77`;
const vault = `${root}/Microsoft.KeyVault/vaults/kv-agentsdlc-dev-7c77`;
const tags = {
  'app-onboard-session-id': '7c770364-fed8-4fc9-95e3-405ad428b06d',
  'app-onboard-skill': 'true',
  'created-at': '2026-11-11T15:43:42.2240991-05:00',
  'deployed-by': 'github-actions',
  environment: 'agentsdlc-dev-7c77'
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
      id: `${root}/Microsoft.ManagedIdentity/userAssignedIdentities/ca-agentsdlc-dev-7c77-${name}-identity`
    }))
  ].map(resource => ({
    ...resource, name: resource.id.split('/').at(-1),
    type: resource.id === registry ? 'Microsoft.ContainerRegistry/registries'
      : resource.id === vault ? 'Microsoft.KeyVault/vaults' : 'Microsoft.ManagedIdentity/userAssignedIdentities',
    resourceGroup: 'agtsdlc-dev-rg', location: 'northeurope', tags: { ...tags }
  }));
  for (const [scope, id, role] of [
    [registry, 'aa520d40-5903-5831-987c-f3857fe688c0', '8311e382-0749-4cb8-b61a-304f252e45ec'],
    [vault, 'a248f7fa-c840-53f1-bb9d-311671c2f582', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7']
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
