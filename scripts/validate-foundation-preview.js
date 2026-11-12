const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');

const subscription = 'b6f10878-9f8a-4b3f-8bc5-3464cdd79c77';
const tenant = '16b3c013-d300-468d-ac64-7eda0820b6d3';
const deployer = '5be11849-e0f0-498e-9529-ef24f0c5c2d1';
const root = `/subscriptions/${subscription}/resourceGroups/agtsdlc-dev-rg/providers`;
const registry = `${root}/Microsoft.ContainerRegistry/registries/cragentsdlcdev7c77`;
const vault = `${root}/Microsoft.KeyVault/vaults/kv-agentsdlc-dev-7c77`;
const identityNames = ['portal', 'apigw', 'orders', 'inventory', 'notify']
  .map(name => `ca-agentsdlc-dev-7c77-${name}-identity`);
const tags = {
  'app-onboard-session-id': '7c770364-fed8-4fc9-95e3-405ad428b06d',
  'app-onboard-skill': 'true',
  'created-at': '2026-11-11T15:43:42.2240991-05:00',
  'deployed-by': 'github-actions',
  environment: 'agentsdlc-dev-7c77'
};
const roles = new Map([
  [registry.toLowerCase(), '8311e382-0749-4cb8-b61a-304f252e45ec'],
  [vault.toLowerCase(), 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7']
]);
const ids = [registry, vault, ...identityNames.map(name => `${root}/Microsoft.ManagedIdentity/userAssignedIdentities/${name}`)];

function validate(preview) {
  if (preview.status !== 'Succeeded' || !Array.isArray(preview.changes) || preview.changes.length !== ids.length + roles.size) {
    throw new Error('Foundation preview is incomplete or has an unexpected number of changes.');
  }
  const expected = new Set(ids.map(id => id.toLowerCase()));
  const actual = new Map();
  const roleAssignments = new Map();
  for (const change of preview.changes) {
    if (!['Create', 'NoChange', 'Modify'].includes(change.changeType) || typeof change.resourceId !== 'string' || !change.after) {
      throw new Error('Foundation preview must contain only fully resolved create, unchanged, or modify resources.');
    }
    const id = change.resourceId.toLowerCase();
    if (change.after.id?.toLowerCase() !== id) {
      throw new Error('Foundation preview contains a mismatched resource ID.');
    }
    if (expected.has(id)) {
      if (actual.has(id)) throw new Error('Foundation preview contains a duplicate resource.');
      actual.set(id, change.after);
      continue;
    }
    const scope = id.startsWith(`${registry.toLowerCase()}/providers/microsoft.authorization/roleassignments/`)
      ? registry.toLowerCase()
      : id.startsWith(`${vault.toLowerCase()}/providers/microsoft.authorization/roleassignments/`)
        ? vault.toLowerCase()
        : null;
    if (!scope || roleAssignments.has(scope) || change.after.type !== 'Microsoft.Authorization/roleAssignments' ||
        change.after.resourceGroup !== 'agtsdlc-dev-rg' || change.after.name?.toLowerCase() !== id.split('/').at(-1) ||
        !/^[0-9a-f-]{36}$/.test(change.after.name)) {
      throw new Error('Foundation preview contains an unexpected, duplicate, or mismatched resource.');
    }
    roleAssignments.set(scope, change.after);
  }
  if (actual.size !== ids.length || roleAssignments.size !== roles.size) {
    throw new Error('Foundation preview is missing expected resources.');
  }
  for (const id of [registry, vault, ...ids.slice(2, 7)]) {
    const after = actual.get(id.toLowerCase());
    const type = id === registry ? 'Microsoft.ContainerRegistry/registries'
      : id === vault ? 'Microsoft.KeyVault/vaults' : 'Microsoft.ManagedIdentity/userAssignedIdentities';
    if (after.name !== id.split('/').at(-1) || after.type !== type ||
        after.resourceGroup !== 'agtsdlc-dev-rg' || after.location !== 'northeurope' ||
        !isDeepStrictEqual(after.tags, tags)) {
      throw new Error('Foundation location or tags differ from the approved configuration.');
    }
  }
  const acr = actual.get(registry.toLowerCase());
  if (acr.sku?.name !== 'Basic' || acr.properties?.adminUserEnabled !== false) {
    throw new Error('Registry settings differ from the approved configuration.');
  }
  const kv = actual.get(vault.toLowerCase());
  if (kv.properties?.tenantId !== tenant || kv.properties?.sku?.name !== 'standard' ||
      kv.properties?.enableRbacAuthorization !== true || kv.properties?.enableSoftDelete !== true ||
      kv.properties?.softDeleteRetentionInDays !== 90 ||
      kv.properties?.networkAcls?.defaultAction !== 'Allow' || kv.properties?.networkAcls?.bypass !== 'AzureServices') {
    throw new Error('Key Vault settings differ from the approved configuration.');
  }
  for (const [scope, role] of roles) {
    const after = roleAssignments.get(scope);
    const properties = after.properties;
    if (properties?.principalId !== deployer ||
        properties?.roleDefinitionId?.toLowerCase() !== `/subscriptions/${subscription}/providers/microsoft.authorization/roledefinitions/${role}`) {
      throw new Error('Foundation role assignment differs from the approved scope and principal.');
    }
  }
  const normalized = new Map(actual);
  for (const [scope, after] of roleAssignments) normalized.set(`role:${scope}`, after);
  return normalized;
}

function validateAgainst(preview, approvedPreview) {
  const actual = validate(preview);
  const approved = validate(approvedPreview);
  for (const [id, after] of actual) {
    if (!isDeepStrictEqual(after, approved.get(id))) {
      throw new Error('Foundation preview changed after approval.');
    }
  }
}

if (require.main === module) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4) {
      throw new Error('Usage: node scripts/validate-foundation-preview.js <preview.json> [approved-preview.json]');
    }
    const preview = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    if (process.argv[3]) {
      validateAgainst(preview, JSON.parse(readFileSync(process.argv[3], 'utf8')));
    } else {
      validate(preview);
    }
    console.log('Foundation preview matches the approved initial scope and configuration.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validate, validateAgainst };
