const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitize, validate, validateAgainst } = require('../scripts/runtime-preview');
const tags = require('../infra/foundation.parameters.json').parameters.tags.value;
const root = '/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/';
const pg = 'Microsoft.DBforPostgreSQL/flexibleServers/pg-agentsdlc-dev-55eb';

function resource(path, type, properties, other = {}) {
  const id = root + path;
  return { resourceId: id, changeType: 'Create', after: {
    id, type, properties, ...other
  } };
}

function core() {
  const located = { location: 'northeurope', tags: { ...tags } };
  return { status: 'Succeeded', changes: [
    resource(pg, 'Microsoft.DBforPostgreSQL/flexibleServers', {
      version: '16', administratorLogin: 'agenticsadmin', administratorLoginPassword: '[REDACTED]',
      storage: { storageSizeGB: 32 }, backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' },
      network: { publicNetworkAccess: 'Enabled' }, highAvailability: { mode: 'Disabled' },
      authConfig: { passwordAuth: 'Enabled' }
    }, { ...located, sku: { name: 'Standard_B1ms', tier: 'Burstable' } }),
    resource(`${pg}/databases/agenticsdldemo`, 'Microsoft.DBforPostgreSQL/flexibleServers/databases', {}),
    resource(`${pg}/configurations/azure.extensions`, 'Microsoft.DBforPostgreSQL/flexibleServers/configurations', {
      value: 'uuid-ossp,pgcrypto,pg_trgm', source: 'user-override'
    }),
    resource(`${pg}/firewallRules/AllowAllAzureServicesAndResourcesWithinAzureIps`, 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules', {
      startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0'
    }),
    resource('Microsoft.OperationalInsights/workspaces/log-agentsdlc-dev-55eb', 'Microsoft.OperationalInsights/workspaces', {
      sku: { name: 'PerGB2018' }, retentionInDays: 30
    }, located),
    resource('Microsoft.Insights/components/appi-agentsdlc-dev-55eb', 'Microsoft.Insights/components', {
      Application_Type: 'web'
    }, located),
    resource('Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb', 'Microsoft.App/managedEnvironments', {
      appLogsConfiguration: { destination: 'log-analytics' }
    }, located),
    resource('Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb/secrets/postgres-database-url', 'Microsoft.KeyVault/vaults/secrets', {
      value: '[REDACTED]'
    })
  ] };
}

test('runtime preview enforces the approved database, telemetry and environment scope', () => {
  assert.doesNotThrow(() => validate(core(), 'core'));
  for (const mutate of [
    p => { p.changes.pop(); },
    p => { p.changes.push(structuredClone(p.changes[0])); },
    p => { p.changes[0].changeType = 'Delete'; },
    p => { p.changes[0].changeType = 'Unsupported'; },
    p => { p.changes[0].after.sku.name = 'Standard_D8s_v3'; },
    p => { p.changes[0].after.location = 'swedencentral'; },
    p => { p.changes[0].after.properties.backup.backupRetentionDays = 1; },
    p => { p.changes[3].after.properties.endIpAddress = '255.255.255.255'; },
    p => { p.changes[6].after.type = 'Microsoft.App/containerApps'; },
    p => { p.changes[7].after.properties.value = 'unredacted'; }
  ]) {
    const p = core();
    mutate(p);
    assert.throws(() => validate(p, 'core'));
  }
  const approved = core();
  const recheck = core();
  recheck.changes.reverse();
  assert.doesNotThrow(() => validateAgainst(recheck, 'core', approved));
  recheck.changes[0].after.apiVersion = 'unreviewed';
  assert.throws(() => validateAgainst(recheck, 'core', approved), /changed after approval/);
  const azurePreview = core();
  azurePreview.changes[0].after.properties.administratorLogin = '*******';
  delete azurePreview.changes[1].after.properties;
  assert.doesNotThrow(() => validate(azurePreview, 'core'));
  azurePreview.changes[0].changeType = 'Modify';
  assert.throws(() => validate(azurePreview, 'core'), /administrator/);
  azurePreview.changes[0].changeType = 'Create';
  azurePreview.changes[0].after.properties.administratorLogin = 'another-admin';
  assert.throws(() => validate(azurePreview, 'core'), /administrator/);
});

test('credential seeding rejects overwrite, deletion and any other secret', () => {
  const preview = { status: 'Succeeded', changes: [
    resource('Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb/secrets/postgres-admin-password',
      'Microsoft.KeyVault/vaults/secrets', { value: '[REDACTED]' })
  ] };
  assert.doesNotThrow(() => validate(preview, 'secrets'));
  for (const type of ['Modify', 'NoChange', 'Delete']) {
    const changed = structuredClone(preview);
    changed.changes[0].changeType = type;
    assert.throws(() => validate(changed, 'secrets'));
  }
  preview.changes[0].resourceId += '-other';
  assert.throws(() => validate(preview, 'secrets'));
});

test('runtime recovery changes only extensions and a new database URL', () => {
  const preview = core();
  preview.changes = [preview.changes[2], preview.changes[7]];
  preview.changes[0].changeType = 'Modify';
  assert.doesNotThrow(() => validate(preview, 'recovery'));
  const overwrite = structuredClone(preview);
  overwrite.changes[1].changeType = 'Modify';
  assert.throws(() => validate(overwrite, 'recovery'), /must not be overwritten/);
  const unexpected = structuredClone(preview);
  unexpected.changes.push(core().changes[0]);
  assert.throws(() => validate(unexpected, 'recovery'));
});

test('stored previews redact credentials, vault values and telemetry keys without hiding security settings', () => {
  const password = 'Aa0_TestCredential55eb0123456789';
  const input = {
    type: 'Microsoft.KeyVault/vaults/secrets',
    properties: { value: `postgresql://user:${password}@db`, enabled: true },
    nested: { administratorLoginPassword: password, sharedKey: 'key', connectionString: 'ikey',
      version: '16', publicNetworkAccess: 'Enabled', message: `contains ${password}` },
    env: [{ name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: 'InstrumentationKey=secret' }],
    delta: [{ path: 'properties.appLogsConfiguration.logAnalyticsConfiguration.sharedKey',
      propertyChangeType: 'Modify', before: 'old-key', after: 'new-key' },
    { path: 'properties.template.containers[0].env[2].value', before: 'old-connection', after: 'new-connection' }],
    configuration: { secrets: [{ name: 'future-secret', value: 'future-value' }] }
  };
  const clean = sanitize(input, password);
  assert.equal(clean.properties.value, '[REDACTED]');
  assert.equal(clean.properties.enabled, true);
  assert.equal(clean.nested.version, '16');
  assert.equal(clean.nested.publicNetworkAccess, 'Enabled');
  assert.equal(clean.env[0].value, '[REDACTED]');
  assert.ok(!JSON.stringify(clean).includes(password));
  for (const key of ['administratorLoginPassword', 'sharedKey', 'connectionString']) {
    assert.equal(clean.nested[key], '[REDACTED]');
  }
  assert.equal(clean.delta[0].before, '[REDACTED]');
  assert.equal(clean.delta[0].after, '[REDACTED]');
  assert.equal(clean.delta[1].before, '[REDACTED]');
  assert.equal(clean.delta[1].after, '[REDACTED]');
  assert.equal(clean.configuration.secrets[0].value, '[REDACTED]');
  assert.equal(input.properties.value, `postgresql://user:${password}@db`);
  const secretChange = sanitize({
    resourceId: `${root}Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb/secrets/postgres-database-url`,
    before: { properties: { value: 'previous-unknown-credential' } },
    delta: [{ path: 'properties', before: { value: 'previous-unknown-credential' },
      after: { value: 'current-credential' } }]
  });
  assert.equal(secretChange.before.properties.value, '[REDACTED]');
  assert.equal(secretChange.delta[0].before.value, '[REDACTED]');
  assert.equal(secretChange.delta[0].after.value, '[REDACTED]');
});
