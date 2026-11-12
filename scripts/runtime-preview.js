const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const foundation = require('../infra/foundation.parameters.json').parameters;

const root = '/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/';
const pg = `${root}Microsoft.DBforPostgreSQL/flexibleServers/pg-agentsdlc-dev-55eb`;
const vault = `${root}Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb`;
const log = `${root}Microsoft.OperationalInsights/workspaces/log-agentsdlc-dev-55eb`;
const insights = `${root}Microsoft.Insights/components/appi-agentsdlc-dev-55eb`;
const environment = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb`;
const credential = `${vault}/secrets/postgres-admin-password`;
const databaseUrl = `${vault}/secrets/postgres-database-url`;

function sanitize(value, password = '', secretContext = false) {
  if (typeof value === 'string') return password ? value.split(password).join('[REDACTED]') : value;
  if (Array.isArray(value)) return value.map(item => sanitize(item, password, secretContext));
  if (!value || typeof value !== 'object') return value;
  const secret = secretContext || /\/secrets$/i.test(value.type || '') ||
    /\/vaults\/[^/]+\/secrets\/[^/]+$/i.test(value.resourceId || '');
  const secretDelta = /(administratorLoginPassword|sharedKey|connectionString|instrumentationKey|^properties\.value$)/i.test(value.path || '');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    (secretDelta && ['before', 'after'].includes(key)) ||
      /^(administratorLoginPassword|sharedKey|connectionString|instrumentationKey)$/i.test(key) ||
      (key === 'value' && secret)
      ? '[REDACTED]'
      : sanitize(item, password, secret)
  ]));
}

function requireValue(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message);
}

function validate(preview, stage) {
  if (!['secrets', 'core'].includes(stage)) throw new Error('Unknown runtime preview stage.');
  if (preview?.status !== 'Succeeded' || !Array.isArray(preview.changes)) {
    throw new Error('Runtime preview did not succeed or is incomplete.');
  }
  const expected = new Map((stage === 'secrets' ? [
    [credential, 'Microsoft.KeyVault/vaults/secrets']
  ] : [
    [pg, 'Microsoft.DBforPostgreSQL/flexibleServers'],
    [`${pg}/databases/agenticsdldemo`, 'Microsoft.DBforPostgreSQL/flexibleServers/databases'],
    [`${pg}/configurations/azure.extensions`, 'Microsoft.DBforPostgreSQL/flexibleServers/configurations'],
    [`${pg}/firewallRules/AllowAllAzureServicesAndResourcesWithinAzureIps`, 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules'],
    [log, 'Microsoft.OperationalInsights/workspaces'],
    [insights, 'Microsoft.Insights/components'],
    [environment, 'Microsoft.App/managedEnvironments'],
    [databaseUrl, 'Microsoft.KeyVault/vaults/secrets']
  ]).map(([id, type]) => [id.toLowerCase(), type.toLowerCase()]));
  const seen = new Set();
  const active = new Map();
  for (const change of preview.changes) {
    const id = change?.resourceId?.toLowerCase();
    if (!id || !id.startsWith(root.toLowerCase()) || seen.has(id)) {
      throw new Error('Runtime preview has a duplicate, unresolved or out-of-scope resource.');
    }
    seen.add(id);
    if (change.changeType === 'Ignore') continue;
    if (!expected.has(id) || !['Create', 'Modify', 'NoChange'].includes(change.changeType) ||
        change.after?.type?.toLowerCase() !== expected.get(id) ||
        change.after?.id?.toLowerCase() !== id) {
      throw new Error('Runtime preview contains an unsupported or unapproved resource change.');
    }
    if (stage === 'secrets' && change.changeType !== 'Create') {
      throw new Error('An existing database credential must never be overwritten.');
    }
    const after = change.after;
    const props = after.properties;
    if (!props || typeof props !== 'object') throw new Error('Runtime properties are unresolved.');
    if ([pg, log, insights, environment].map(value => value.toLowerCase()).includes(id)) {
      requireValue(after.location, 'northeurope', 'Runtime region differs from the approved plan.');
      for (const [key, value] of Object.entries(foundation.tags.value)) {
        requireValue(after.tags?.[key], value, 'Runtime tags differ from the approved plan.');
      }
    }
    if (id === pg.toLowerCase()) {
      requireValue(after.sku?.name, 'Standard_B1ms', 'PostgreSQL size changed.');
      requireValue(after.sku?.tier, 'Burstable', 'PostgreSQL tier changed.');
      requireValue(props.version, '16', 'PostgreSQL version changed.');
      requireValue(props.administratorLogin, 'agenticsadmin', 'PostgreSQL administrator changed.');
      requireValue(props.storage?.storageSizeGB, 32, 'PostgreSQL storage changed.');
      requireValue(props.backup?.backupRetentionDays, 7, 'PostgreSQL backup retention changed.');
      requireValue(props.backup?.geoRedundantBackup, 'Disabled', 'PostgreSQL backup topology changed.');
      requireValue(props.network?.publicNetworkAccess, 'Enabled', 'PostgreSQL network plan changed.');
      requireValue(props.highAvailability?.mode, 'Disabled', 'PostgreSQL availability plan changed.');
      requireValue(props.authConfig?.passwordAuth, 'Enabled', 'PostgreSQL password authentication changed.');
    } else if (id.includes('/firewallrules/')) {
      requireValue(props.startIpAddress, '0.0.0.0', 'The approved demo firewall exception changed.');
      requireValue(props.endIpAddress, '0.0.0.0', 'The approved demo firewall exception changed.');
    } else if (id.includes('/configurations/')) {
      requireValue(props.value, 'uuid-ossp,pgcrypto,pg_trgm', 'PostgreSQL extension configuration changed.');
      requireValue(props.source, 'user-override', 'PostgreSQL extension source changed.');
    } else if (id === log.toLowerCase()) {
      requireValue(props.retentionInDays, 30, 'Log retention changed.');
      requireValue(props.sku?.name, 'PerGB2018', 'Log Analytics billing plan changed.');
    } else if (id === insights.toLowerCase()) {
      requireValue(props.Application_Type, 'web', 'Application Insights type changed.');
    } else if (id === environment.toLowerCase()) {
      requireValue(props.appLogsConfiguration?.destination, 'log-analytics', 'Runtime log destination changed.');
    } else if (id.includes('/secrets/')) {
      requireValue(props.value, '[REDACTED]', 'Secret data must be redacted before preview storage.');
    }
    active.set(id, { changeType: change.changeType, after });
  }
  if (active.size !== expected.size) throw new Error('Runtime preview is missing approved resources.');
  return active;
}

function validateAgainst(preview, stage, approved) {
  const current = validate(preview, stage);
  const baseline = validate(approved, stage);
  for (const [id, resource] of current) {
    if (!isDeepStrictEqual(resource, baseline.get(id))) {
      throw new Error('Runtime preview changed after approval.');
    }
  }
}

if (require.main === module) {
  try {
    const [mode, file, approved] = process.argv.slice(2);
    if (mode === 'sanitize') {
      console.log(JSON.stringify(sanitize(JSON.parse(readFileSync(0, 'utf8')), process.env.POSTGRES_ADMIN_PASSWORD), null, 2));
    } else {
      const read = path => JSON.parse(readFileSync(path, 'utf8'));
      if (!file || !['core', 'secrets'].includes(mode)) throw new Error('Usage: runtime-preview.js <core|secrets> <preview> [approved-preview], or sanitize on stdin.');
      if (approved) validateAgainst(read(file), mode, read(approved));
      else validate(read(file), mode);
      console.log(`Runtime ${mode} preview matches the approved scope.`);
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { sanitize, validate, validateAgainst };
