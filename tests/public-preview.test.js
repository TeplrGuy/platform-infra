const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { images, validate, validateAgainst, validateLive, validateLoginRedirect } = require('../scripts/public-preview');
const release = require('../infra/private-release.json');
const foundation = require('../infra/foundation.parameters.json').parameters;

const refs = Object.fromEntries(release.services.map(service => [service.refEnv, service.revision]));
const root = '/subscriptions/b6f10878-9f8a-4b3f-8bc5-3464cdd79c77/resourceGroups/agtsdlc-dev-rg/providers/';
const domain = 'example-1234.northeurope.azurecontainerapps.io';
const clientId = 'c0ffee00-1234-4567-89ab-0123456789ab';
const tenantId = '16b3c013-d300-468d-ac64-7eda0820b6d3';
const names = foundation.appNames.value;
const environmentId = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb`;
const vaultId = `${root}Microsoft.KeyVault/vaults/kv-agentsdlc-dev-55eb`;
const build = process.platform === 'win32'
  ? spawnSync('az bicep build --file infra/public-workloads.bicep --stdout', { shell: true, encoding: 'utf8' })
  : spawnSync('az', ['bicep', 'build', '--file', 'infra/public-workloads.bicep', '--stdout'], { encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr || build.error?.message);
const template = JSON.parse(build.stdout);

function preview() {
  const expectedImages = images(refs);
  const changes = names.map((name, index) => {
    const identity = `${root}Microsoft.ManagedIdentity/userAssignedIdentities/${name}-identity`;
    const id = `${root}Microsoft.App/containerApps/${name}`;
    const secretNames = index === 0 ? ['entra-client-secret'] : index >= 2 ? ['postgres-database-url'] : [];
    const secrets = secretNames.map(secretName => ({
      name: secretName,
      identity,
      keyVaultUrl: `https://kv-agentsdlc-dev-55eb.vault.azure.net/secrets/${secretName}`
    }));
    return {
      changeType: 'Create',
      resourceId: id,
      after: {
        id,
        type: 'Microsoft.App/containerApps',
        location: 'northeurope',
        tags: foundation.tags.value,
        identity: { type: 'UserAssigned', userAssignedIdentities: { [identity]: {} } },
        properties: {
          managedEnvironmentId: environmentId,
          configuration: {
            ingress: { external: index === 0, targetPort: 3000 },
            secrets
          },
          template: { containers: [{ image: expectedImages[release.services[index].key] }] }
        }
      }
    };
  });
  changes.push({
    changeType: 'Create',
    resourceId: `${vaultId}/secrets/entra-client-secret`,
    after: {
      id: `${vaultId}/secrets/entra-client-secret`,
      type: 'Microsoft.KeyVault/vaults/secrets',
      properties: { value: '[REDACTED]', contentType: 'text/plain' }
    }
  });
  changes.push({
    changeType: 'Create',
    resourceId: `${root}Microsoft.App/containerApps/${names[0]}/authConfigs/current`,
    after: {
      id: `${root}Microsoft.App/containerApps/${names[0]}/authConfigs/current`,
      type: 'Microsoft.App/containerApps/authConfigs',
      properties: {
        platform: { enabled: true },
        globalValidation: { unauthenticatedClientAction: 'RedirectToLoginPage' },
        identityProviders: { azureActiveDirectory: { registration: {
          clientId,
          openIdIssuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
          clientSecretSettingName: 'entra-client-secret'
        } } }
      }
    }
  });
  return { status: 'Succeeded', changes };
}

function liveApps() {
  const expectedImages = images(refs);
  return names.map((name, index) => ({
    state: 'Succeeded',
    external: index === 0,
    fqdn: index === 0 ? `${name}.${domain}` : `${name}.internal.${domain}`,
    targetPort: 3000,
    image: expectedImages[release.services[index].key]
  }));
}

function liveAuth() {
  return {
    platform: { enabled: true },
    globalValidation: { unauthenticatedClientAction: 'RedirectToLoginPage' },
    identityProviders: { azureActiveDirectory: { enabled: true, registration: {
      clientId,
      openIdIssuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      clientSecretSettingName: 'entra-client-secret'
    } } }
  };
}

test('public what-if accepts only the pinned images and Entra-protected portal scope', () => {
  const changes = preview();
  assert.doesNotThrow(() => validate(changes, domain, refs, template, clientId, tenantId));
  for (const mutate of [
    p => { p.changes[1].after.properties.configuration.ingress.external = true; },
    p => { p.changes[0].after.properties.template.containers[0].image += ':latest'; },
    p => { p.changes[5].after.properties.value = 'unredacted'; },
    p => { p.changes[6].after.properties.identityProviders.azureActiveDirectory.registration.clientId = 'wrong'; },
    p => { p.changes.pop(); },
    p => { p.changes[0].resourceId = `${root}Microsoft.App/containerApps/other`; }
  ]) {
    const changed = structuredClone(changes);
    mutate(changed);
    assert.throws(() => validate(changed, domain, refs, template, clientId, tenantId));
  }
});

test('public apply rejects a changed preview and live resource/auth drift', () => {
  const approved = preview();
  const current = structuredClone(approved);
  assert.doesNotThrow(() => validateAgainst(current, approved, domain, refs, template, clientId, tenantId));
  current.changes[0].after.properties.configuration.ingress.external = false;
  assert.throws(() => validateAgainst(current, approved, domain, refs, template, clientId, tenantId));

  const apps = liveApps();
  assert.doesNotThrow(() => validateLive(apps, liveAuth(), domain, refs, clientId, tenantId));
  const changedApps = structuredClone(apps);
  changedApps[0].fqdn = `unexpected.${domain}`;
  assert.throws(() => validateLive(changedApps, liveAuth(), domain, refs, clientId, tenantId));
  const publicBackend = structuredClone(apps);
  publicBackend[1].external = true;
  assert.throws(() => validateLive(publicBackend, liveAuth(), domain, refs, clientId, tenantId));
  const staleImage = structuredClone(apps);
  staleImage[2].image += ':latest';
  assert.throws(() => validateLive(staleImage, liveAuth(), domain, refs, clientId, tenantId));
  const changedAuth = liveAuth();
  changedAuth.globalValidation.unauthenticatedClientAction = 'AllowAnonymous';
  assert.throws(() => validateLive(apps, changedAuth, domain, refs, clientId, tenantId));
});

test('anonymous portal smoke test requires the approved Entra authorization redirect', () => {
  const response = `HTTP/2 302 Found\r\nlocation: https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code\r\n`;
  assert.doesNotThrow(() => validateLoginRedirect(response, clientId, tenantId));
  assert.throws(() => validateLoginRedirect('HTTP/2 200 OK\r\n', clientId, tenantId));
  assert.throws(() => validateLoginRedirect(response.replace(tenantId, '00000000-0000-0000-0000-000000000000'), clientId, tenantId));
  assert.throws(() => validateLoginRedirect(response.replace(clientId, 'c0ffee00-0000-0000-0000-000000000000'), clientId, tenantId));
});
