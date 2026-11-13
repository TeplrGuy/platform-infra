const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const release = require('../infra/private-release.json');
const foundation = require('../infra/foundation.parameters.json').parameters;

const subscription = 'b6f10878-9f8a-4b3f-8bc5-3464cdd79c77';
const tenant = '16b3c013-d300-468d-ac64-7eda0820b6d3';
const resourceGroup = 'agtsdlc-dev-rg';
const root = `/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/`;
const names = foundation.appNames.value;
const registry = 'cragentsdlcdev7c77.azurecr.io';
const vaultId = `${root}Microsoft.KeyVault/vaults/kv-agentsdlc-dev-7c77`;
const vaultUri = 'https://kv-agentsdlc-dev-7c77.vault.azure.net/';
const environmentId = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-7c77`;
const authConfigId = `${root}Microsoft.App/containerApps/${names[0]}/authConfigs/current`;
const entraSecretId = `${vaultId}/secrets/entra-client-secret`;
const refNames = ['PORTAL_REF', 'GATEWAY_REF', 'ORDERS_REF', 'INVENTORY_REF', 'NOTIFICATIONS_REF'];

function images(refs) {
  if (release.publisherRun !== '43311421332' || release.services.length !== 5) {
    throw new Error('Public promotion requires the complete pinned private release.');
  }
  return Object.fromEntries(release.services.map((service, index) => {
    if (refs[refNames[index]] !== service.revision ||
        !/^[a-f0-9]{40}$/.test(service.revision) ||
        !/^sha256:[a-f0-9]{64}$/.test(service.digest)) {
      throw new Error('Public promotion source revisions do not match the reviewed private release.');
    }
    return [service.key, `${registry}/${service.name}@${service.digest}`];
  }));
}

function requireValue(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message);
}

function validateTemplate(template) {
  const resources = Object.values(template?.resources || {});
  const workload = resources.find(resource => resource.name === 'public-workloads');
  const moduleResources = Object.values(workload?.properties?.template?.resources || {});
  const app = moduleResources.find(resource => resource.type === 'Microsoft.App/containerApps');
  const auth = moduleResources.find(resource => resource.type === 'Microsoft.App/containerApps/authConfigs');
  const moduleParameters = workload?.properties?.parameters;
  const moduleVariables = workload?.properties?.template?.variables;
  const secret = resources.find(resource => resource.type === 'Microsoft.KeyVault/vaults/secrets');
  if (resources.length !== 2 || !workload || !app || !auth || !secret ||
      moduleParameters?.isPlaceholder?.value !== false ||
      moduleParameters?.enablePublicIngress?.value !== true ||
      moduleParameters?.enableEntraAuth?.value !== true ||
      moduleParameters?.entraClientId?.value !== "[parameters('entraClientId')]" ||
      moduleParameters?.entraTenantId?.value !== "[parameters('entraTenantId')]" ||
      template.parameters?.entraClientSecret?.type?.toLowerCase() !== 'securestring') {
    throw new Error('Compiled public workload template differs from the protected promotion design.');
  }
  if (auth.condition !== "[and(not(parameters('isPlaceholder')), parameters('enableEntraAuth'))]" ||
      auth.properties?.globalValidation?.unauthenticatedClientAction !== 'RedirectToLoginPage' ||
      auth.properties?.identityProviders?.azureActiveDirectory?.registration?.clientId !== "[parameters('entraClientId')]" ||
      auth.properties?.identityProviders?.azureActiveDirectory?.registration?.clientSecretSettingName !== "[variables('entraSecret')]" ||
      auth.properties?.identityProviders?.azureActiveDirectory?.registration?.openIdIssuer !==
        "[format('https://login.microsoftonline.com/{0}/v2.0', parameters('entraTenantId'))]" ||
      moduleVariables?.entraSecret !== 'entra-client-secret' ||
      secret.properties?.value !== "[parameters('entraClientSecret')]" ||
      secret.properties?.contentType !== 'text/plain') {
    throw new Error('Compiled portal authentication is not Entra-protected.');
  }
  const services = workload.properties.template.variables.services;
  if (services.length !== 5 || services[0].external !== true ||
      services.slice(1).some(service => service.external !== false)) {
    throw new Error('Only the portal may receive public ingress.');
  }
}

function validate(preview, domain, refs, template, clientId, tenantId) {
  validateTemplate(template);
  const expectedImages = images(refs);
  if (!/^[a-z0-9-]+\.northeurope\.azurecontainerapps\.io$/.test(domain)) {
    throw new Error('Public promotion environment domain is outside the approved North Europe target.');
  }
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(clientId) || tenantId !== tenant) {
    throw new Error('Entra client or tenant configuration is invalid.');
  }
  if (preview?.status !== 'Succeeded' || !Array.isArray(preview.changes)) {
    throw new Error('Public promotion preview did not succeed or is incomplete.');
  }

  const expected = new Map([
    ...names.map((name, index) => [
      `${root}Microsoft.App/containerApps/${name}`.toLowerCase(),
      { kind: 'app', index }
    ]),
    [entraSecretId.toLowerCase(), { kind: 'secret' }],
    [authConfigId.toLowerCase(), { kind: 'auth' }]
  ]);
  const seen = new Set();
  const active = new Map();
  for (const change of preview.changes) {
    const id = change?.resourceId?.toLowerCase();
    if (!id || !id.startsWith(root.toLowerCase())) {
      throw new Error('Public promotion preview contains a duplicate or out-of-scope resource.');
    }
    if (change.changeType === 'Ignore') continue;
    if (seen.has(id) || !expected.has(id)) {
      throw new Error('Public promotion preview contains a duplicate or out-of-scope resource.');
    }
    seen.add(id);
    if (!['Create', 'Modify', 'NoChange'].includes(change.changeType) ||
        change.after?.id?.toLowerCase() !== id) {
      throw new Error('Public promotion preview contains an unsupported resource change.');
    }
    const target = expected.get(id);
    const after = change.after;
    if (target.kind === 'app') {
      if (after.type?.toLowerCase() !== 'microsoft.app/containerapps' ||
          after.location !== 'northeurope') {
        throw new Error('Public workload resource type or region differs from the approved target.');
      }
      for (const [key, value] of Object.entries(foundation.tags.value)) {
        requireValue(after.tags?.[key], value, 'Public workload tags differ from the approved plan.');
      }
      const identity = `${root}Microsoft.ManagedIdentity/userAssignedIdentities/${names[target.index]}-identity`;
      const properties = after.properties;
      const expectedExternal = target.index === 0;
      if (properties?.managedEnvironmentId?.toLowerCase() !== environmentId.toLowerCase() ||
          after.identity?.type !== 'UserAssigned' ||
          !Object.keys(after.identity.userAssignedIdentities || {}).some(value => value.toLowerCase() === identity.toLowerCase()) ||
          properties.configuration?.ingress?.external !== expectedExternal ||
          properties.configuration.ingress.targetPort !== 3000 ||
          properties.template?.containers?.length !== 1 ||
          properties.template.containers[0].image !== expectedImages[release.services[target.index].key]) {
        throw new Error('Public workload image, ingress, identity, or environment differs from the approved plan.');
      }
      const secrets = properties.configuration.secrets || [];
      if (target.index === 0) {
        if (secrets.length !== 1 || !['entra-client-secret', '*******'].includes(secrets[0]?.name)) {
          throw new Error('Public workload Key Vault secret bindings differ from the approved plan.');
        }
        const secret = secrets[0];
        const vaultReference = `[concat(reference('${vaultId}', '2026-05-15').vaultUri, 'secrets/', 'entra-client-secret')]`;
        if (secret.identity?.toLowerCase() !== identity.toLowerCase() ||
            ![`${vaultUri}secrets/entra-client-secret`, vaultReference, '*******'].includes(secret.keyVaultUrl)) {
          throw new Error('Portal Entra secret is not bound to the approved Key Vault identity.');
        }
      } else if (target.index >= 2) {
        if (secrets.length !== 1) throw new Error('Public workload Key Vault secret bindings differ from the approved plan.');
        const secret = secrets[0];
        const unresolved = typeof secret === 'string' &&
          secret.includes("createObject('name', variables('databaseUrlSecret')") &&
          secret.includes("'postgres-database-url'");
        if (!unresolved && secret?.name !== 'postgres-database-url') {
          throw new Error('Public workload Key Vault secret bindings differ from the approved plan.');
        }
      } else if (secrets.length) {
        throw new Error('Public workload Key Vault secret bindings differ from the approved plan.');
      }
    } else if (target.kind === 'secret') {
      if (after.type?.toLowerCase() !== 'microsoft.keyvault/vaults/secrets' ||
          !['[REDACTED]', '*******'].includes(after.properties?.value) ||
          after.properties?.contentType !== 'text/plain') {
        throw new Error('Entra client secret is not safely stored in Key Vault.');
      }
    } else {
      const registration = after.properties?.identityProviders?.azureActiveDirectory?.registration;
      if (after.type?.toLowerCase() !== 'microsoft.app/containerapps/authconfigs' ||
          after.properties?.platform?.enabled !== true ||
          after.properties?.globalValidation?.unauthenticatedClientAction !== 'RedirectToLoginPage' ||
          registration?.clientId?.toLowerCase() !== clientId.toLowerCase() ||
          registration?.openIdIssuer !== `https://login.microsoftonline.com/${tenantId}/v2.0` ||
          !['entra-client-secret', '*******'].includes(registration?.clientSecretSettingName)) {
        throw new Error('Portal Entra authentication configuration differs from the approved target.');
      }
    }
    active.set(id, { changeType: change.changeType, after });
  }
  if (active.size !== expected.size) {
    throw new Error('Public promotion preview is missing one or more approved resources.');
  }
  return active;
}

function validateAgainst(preview, approved, domain, refs, template, clientId, tenantId) {
  const current = validate(preview, domain, refs, template, clientId, tenantId);
  const baseline = validate(approved, domain, refs, template, clientId, tenantId);
  for (const [id, resource] of current) {
    if (!isDeepStrictEqual(resource, baseline.get(id))) {
      throw new Error('Public promotion preview changed after approval.');
    }
  }
}

function validateLive(apps, auth, domain, refs, clientId, tenantId) {
  const expectedImages = images(refs);
  if (!Array.isArray(apps) || apps.length !== names.length) {
    throw new Error('Public release readback does not include all five workloads.');
  }
  for (let index = 0; index < names.length; index++) {
    const app = apps[index];
    if (app.state !== 'Succeeded' || app.external !== (index === 0) ||
        app.image !== expectedImages[release.services[index].key] || app.targetPort !== 3000) {
      throw new Error(`Public release readback differs from the approved workload: ${names[index]}.`);
    }
    if (index === 0 && app.fqdn !== `${names[0]}.${domain}`) {
      throw new Error('Public portal FQDN differs from the approved URL.');
    }
  }
  const registration = auth?.identityProviders?.azureActiveDirectory?.registration;
  if (auth?.platform?.enabled !== true ||
      auth?.globalValidation?.unauthenticatedClientAction !== 'RedirectToLoginPage' ||
      auth?.identityProviders?.azureActiveDirectory?.enabled !== true ||
      registration?.clientId?.toLowerCase() !== clientId.toLowerCase() ||
      registration?.openIdIssuer !== `https://login.microsoftonline.com/${tenantId}/v2.0` ||
      registration?.clientSecretSettingName !== 'entra-client-secret') {
    throw new Error('Live portal authentication does not match the approved Entra configuration.');
  }
}

function validateLoginRedirect(response, clientId, tenantId) {
  const status = response.match(/(?:^|\r?\n)HTTP\/\S+\s+(\d{3})\s/m)?.[1];
  const location = response.match(/^location:\s*(\S+)/im)?.[1];
  let redirect;
  try {
    redirect = new URL(location);
  } catch {
    throw new Error('Unauthenticated portal request did not redirect to Entra sign-in.');
  }
  if (status !== '302' || redirect.protocol !== 'https:' ||
      redirect.hostname !== 'login.microsoftonline.com' ||
      redirect.pathname.toLowerCase() !== `/${tenantId.toLowerCase()}/oauth2/v2.0/authorize` ||
      redirect.searchParams.get('client_id')?.toLowerCase() !== clientId.toLowerCase()) {
    throw new Error('Unauthenticated portal request did not redirect to the approved Entra tenant and client.');
  }
}

if (require.main === module) {
  try {
    const [file, domain, templateFile, approvedFile] = process.argv.slice(2);
    if (!file || !domain || !templateFile) {
      throw new Error('Usage: public-preview.js <preview> <domain> <compiled-template> [approved-preview]');
    }
    const refs = Object.fromEntries(refNames.map(name => [name, process.env[name]]));
    const preview = JSON.parse(readFileSync(file, 'utf8'));
    const template = JSON.parse(readFileSync(templateFile, 'utf8'));
    if (approvedFile) {
      validateAgainst(preview, JSON.parse(readFileSync(approvedFile, 'utf8')), domain, refs, template,
        process.env.ENTRA_CLIENT_ID, process.env.ENTRA_TENANT_ID);
    } else {
      validate(preview, domain, refs, template, process.env.ENTRA_CLIENT_ID, process.env.ENTRA_TENANT_ID);
    }
    console.log('Public promotion preview matches the pinned images and protected scope.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  images,
  validate,
  validateAgainst,
  validateLive,
  validateLoginRedirect,
  validateTemplate
};
