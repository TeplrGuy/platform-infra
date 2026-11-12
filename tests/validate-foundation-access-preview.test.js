const assert = require('node:assert/strict');
const test = require('node:test');
const { createParameters } = require('../scripts/foundation-access-parameters');
const { validate, validateAgainst } = require('../scripts/validate-foundation-access-preview');

const subscription = 'b6f10878-9f8a-4b3f-8bc5-3464cdd79c77';
const root = `/subscriptions/${subscription}/resourceGroups/agtsdlc-dev-rg/providers`;
const registry = `${root}/Microsoft.ContainerRegistry/registries/cragentsdlcdev55eb`;
const vault = `${root}/Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb`;
const roleRoot = `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions`;
const ids = [1, 2, 3, 4, 5].map(i => `00000000-0000-0000-0000-00000000000${i}`);
const deployer = 'b6a3c39d-0263-4f01-b975-654cdea443a0';

function fixture() {
  const parameters = createParameters(ids);
  const changes = [registry, vault, ...['portal', 'apigw', 'orders', 'inventory', 'notify']
    .map(name => `${root}/Microsoft.ManagedIdentity/userAssignedIdentities/ca-agentsdlc-dev-55eb-${name}-identity`)]
    .map(resourceId => ({ resourceId, changeType: 'Ignore', after: null }));
  function grant(scope, name, principalId, role, changeType) {
    const resourceId = `${scope}/providers/Microsoft.Authorization/roleAssignments/${name}`;
    changes.push({ resourceId, changeType, after: {
      id: resourceId, name, type: 'Microsoft.Authorization/roleAssignments', resourceGroup: 'agtsdlc-dev-rg',
      properties: { principalId, roleDefinitionId: `${roleRoot}/${role}` }
    } });
  }
  grant(registry, '221ab1b6-b619-5181-a3ae-13e714ec1e42', deployer, '8311e382-0749-4cb8-b61a-304f252e45ec', 'NoChange');
  grant(vault, 'dac8d4ef-1356-5c48-822f-63aff5e58233', deployer, 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7', 'NoChange');
  ids.forEach((id, i) => grant(registry, `11111111-1111-1111-1111-11111111111${i}`, id,
    '7f951dda-4ed3-4680-a7ca-43fe172d538d', 'Create'));
  [0, 2, 3, 4].forEach((i, j) => grant(vault, `22222222-2222-2222-2222-22222222222${j}`, ids[i],
    '4633458b-17de-408a-b874-0445c86b69e6', 'Create'));
  return { preview: { status: 'Succeeded', changes }, parameters };
}

test('accepts only expected application roles and foundation resources', () => {
  const { preview, parameters } = fixture();
  assert.doesNotThrow(() => validate(preview, parameters));
  for (const mutate of [
    p => { p.changes.pop(); },
    p => { p.changes[0].changeType = 'Delete'; },
    p => { p.changes[7].changeType = 'Modify'; },
    p => { p.changes[9].after.properties.principalId = deployer; },
    p => { p.changes[9].after.properties.roleDefinitionId += '-other'; },
    p => { p.changes[1].resourceId = p.changes[0].resourceId; }
  ]) {
    const f = fixture();
    mutate(f.preview);
    assert.throws(() => validate(f.preview, f.parameters));
  }
});

test('rejects identity and preview drift after approval', () => {
  const approved = fixture();
  const actual = fixture();
  actual.preview.changes.reverse();
  assert.doesNotThrow(() => validateAgainst(actual.preview, actual.parameters, approved.preview, approved.parameters));
  actual.preview.changes[0].after.apiVersion = 'changed';
  assert.throws(() => validateAgainst(actual.preview, actual.parameters, approved.preview, approved.parameters), /changed after approval/);
  const changed = fixture();
  changed.parameters.parameters.appPrincipalIds.value[0] = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  assert.throws(() => validateAgainst(changed.preview, changed.parameters, approved.preview, approved.parameters), /Identity parameters changed/);
});
