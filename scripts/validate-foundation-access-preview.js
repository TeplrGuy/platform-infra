const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { createParameters } = require('./foundation-access-parameters');

const subscription = 'b6f10878-9f8a-4b3f-8bc5-3464cdd79c77';
const root = `/subscriptions/${subscription}/resourceGroups/agtsdlc-dev-rg/providers`;
const registry = `${root}/Microsoft.ContainerRegistry/registries/cragentsdlcdev55eb`;
const vault = `${root}/Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb`;
const roleRoot = `/subscriptions/${subscription}/providers/Microsoft.Authorization/roleDefinitions`;
const acrPull = `${roleRoot}/7f951dda-4ed3-4680-a7ca-43fe172d538d`;
const secretUser = `${roleRoot}/4633458b-17de-408a-b874-0445c86b69e6`;
const deployer = '68b48a36-c15b-4e51-a9a5-f26e6b6a342b';
const unchanged = new Map([
  [`${registry}/providers/Microsoft.Authorization/roleAssignments/aa520d40-5903-5831-987c-f3857fe688c0`.toLowerCase(), `${roleRoot}/8311e382-0749-4cb8-b61a-304f252e45ec`.toLowerCase()],
  [`${vault}/providers/Microsoft.Authorization/roleAssignments/a248f7fa-c840-53f1-bb9d-311671c2f582`.toLowerCase(), `${roleRoot}/b86a8fe4-44ce-4948-aee5-eccb2c155cd7`.toLowerCase()]
]);
const ignored = new Set([registry, vault, ...['portal', 'apigw', 'orders', 'inventory', 'notify']
  .map(name => `${root}/Microsoft.ManagedIdentity/userAssignedIdentities/ca-agentsdlc-dev-55eb-${name}-identity`)]
  .map(id => id.toLowerCase()));

function validate(preview, parameters) {
  const principalIds = parameters?.parameters?.appPrincipalIds?.value;
  if (!Array.isArray(principalIds) || !isDeepStrictEqual(parameters, createParameters(principalIds))) {
    throw new Error('Access parameters do not match the approved foundation.');
  }
  if (preview.status !== 'Succeeded' || !Array.isArray(preview.changes) || preview.changes.length !== 18) {
    throw new Error('Access preview is incomplete or has unexpected changes.');
  }
  const required = new Set([
    ...principalIds.map(id => `${registry}|${id}|${acrPull}`.toLowerCase()),
    ...[0, 2, 3, 4].map(i => `${vault}|${principalIds[i]}|${secretUser}`.toLowerCase())
  ]);
  const seen = new Map();
  const ignoredFound = new Set();
  const unchangedFound = new Set();
  for (const change of preview.changes) {
    if (typeof change.resourceId !== 'string') throw new Error('Access preview contains an unresolved resource.');
    const id = change.resourceId.toLowerCase();
    if (seen.has(id)) throw new Error('Access preview contains a duplicate resource.');
    seen.set(id, { changeType: change.changeType, after: change.after });
    if (change.changeType === 'Ignore' && ignored.has(id)) {
      ignoredFound.add(id);
      continue;
    }
    const after = change.after;
    const prefix = id.startsWith(`${registry.toLowerCase()}/providers/microsoft.authorization/roleassignments/`)
      ? registry : id.startsWith(`${vault.toLowerCase()}/providers/microsoft.authorization/roleassignments/`) ? vault : null;
    if (!prefix || !after || after.id?.toLowerCase() !== id ||
        after.type !== 'Microsoft.Authorization/roleAssignments' || after.resourceGroup !== 'agtsdlc-dev-rg' ||
        after.name?.toLowerCase() !== id.split('/').at(-1) || !/^[0-9a-f-]{36}$/.test(after.name)) {
      throw new Error('Access preview contains an unexpected resource or assignment.');
    }
    const role = after.properties?.roleDefinitionId?.toLowerCase();
    const principal = after.properties?.principalId?.toLowerCase();
    if (change.changeType === 'Create') {
      const grant = `${prefix}|${principal}|${role}`.toLowerCase();
      if (!required.delete(grant)) throw new Error('Access preview grants an unexpected or duplicate role.');
    } else if (change.changeType === 'NoChange' && unchanged.get(id) === role && principal === deployer) {
      unchangedFound.add(id);
    } else {
      throw new Error('Access preview changes an unapproved role assignment.');
    }
  }
  if (required.size || ignoredFound.size !== ignored.size || unchangedFound.size !== unchanged.size) {
    throw new Error('Access preview is missing expected roles or foundation resources.');
  }
  return seen;
}

function validateAgainst(preview, parameters, approved, approvedParameters) {
  if (!isDeepStrictEqual(parameters, approvedParameters)) throw new Error('Identity parameters changed after approval.');
  const current = validate(preview, parameters);
  const baseline = validate(approved, approvedParameters);
  for (const [id, change] of current) {
    if (!isDeepStrictEqual(change, baseline.get(id))) throw new Error('Access preview changed after approval.');
  }
}

if (require.main === module) {
  try {
    if (![4, 6].includes(process.argv.length)) {
      throw new Error('Usage: node scripts/validate-foundation-access-preview.js <preview> <parameters> [approved-preview approved-parameters]');
    }
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    if (process.argv.length === 6) {
      validateAgainst(read(process.argv[2]), read(process.argv[3]), read(process.argv[4]), read(process.argv[5]));
    } else {
      validate(read(process.argv[2]), read(process.argv[3]));
    }
    console.log('Application access preview matches the approved scope and roles.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validate, validateAgainst };
