const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const compiledTemplates = new Map();
function getTemplate(file = 'infra/main.bicep') {
  if (compiledTemplates.has(file)) return compiledTemplates.get(file);
  const options = { cwd: path.join(__dirname, '..'), encoding: 'utf8' };
  const result = process.platform === 'win32'
    ? spawnSync(`az bicep build --file ${file} --stdout`, { ...options, shell: true })
    : spawnSync('az', ['bicep', 'build', '--file', file, '--stdout'], options);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const template = JSON.parse(result.stdout);
  compiledTemplates.set(file, template);
  return template;
}

test('public ingress is opt-in and requires application authentication', () => {
  const template = getTemplate();
  assert.match(template.$schema, /\/deploymentTemplate\.json#/);
  assert.equal(template.outputs.resourceGroupName.value, '[resourceGroup().name]');
  assert.ok(Object.values(template.resources).every(resource => resource.type !== 'Microsoft.Resources/resourceGroups'));
  assert.equal(template.parameters.enablePublicIngress.defaultValue, false);
  assert.equal(
    template.variables.enableEntraAuth,
    "[and(not(empty(parameters('entraClientId'))), not(empty(parameters('entraClientSecret'))))]"
  );

  const module = Object.values(template.resources).find(resource => resource.name === 'container-apps');
  assert.equal(module.properties.parameters.enablePublicIngress.value, "[parameters('enablePublicIngress')]");
  assert.equal(module.properties.parameters.enableEntraAuth.value, "[variables('enableEntraAuth')]");
  const resources = Object.values(module.properties.template.resources);
  const apps = resources.find(resource => resource.type === 'Microsoft.App/containerApps');
  assert.equal(
    apps.properties.configuration.ingress.external,
    "[and(and(and(variables('services')[copyIndex()].external, parameters('enablePublicIngress')), not(parameters('isPlaceholder'))), parameters('enableEntraAuth'))]"
  );
  const auth = resources.find(resource => resource.type === 'Microsoft.App/containerApps/authConfigs');
  assert.equal(auth.condition, "[and(not(parameters('isPlaceholder')), parameters('enableEntraAuth'))]");
  assert.ok(auth.dependsOn.includes('apps'));
});

test('service callers use HTTPS and internal Container Apps hostnames', () => {
  const template = getTemplate().resources.apps.properties.template;
  assert.ok(template.variables.services.slice(1).every(service => service.external === false));
  const app = Object.values(template.resources).find(resource => resource.type === 'Microsoft.App/containerApps');
  const urls = app.properties.template.containers[0].env.match(
    /concat\('https:\/\/', variables\('names'\)\[\d+\], '\.internal\.', parameters\('environmentDefaultDomain'\)\)/g
  );
  assert.deepEqual(urls, [1, 2, 3, 3, 4].map(index =>
    `concat('https://', variables('names')[${index}], '.internal.', parameters('environmentDefaultDomain'))`
  ));
});

test('foundation contains no workload or secrets and scopes publisher access to the registry', () => {
  const template = getTemplate('infra/foundation.bicep');
  const foundation = JSON.parse(readFileSync(path.join(__dirname, '../infra/foundation.parameters.json')));
  const application = JSON.parse(readFileSync(path.join(__dirname, '../infra/main.parameters.json')));
  const names = application.parameters.resourceNames.value;
  assert.equal(foundation.parameters.registryName.value, names.registry);
  assert.equal(foundation.parameters.keyVaultName.value, names.keyVault);
  assert.deepEqual(foundation.parameters.appNames.value,
    [names.portal, names.apiGateway, names.orders, names.inventory, names.notifications]);
  assert.equal(foundation.parameters.location.value, application.parameters.location.value);
  assert.equal(template.parameters.appNames.minLength, 5);
  assert.equal(template.parameters.appNames.maxLength, 5);
  const modules = Object.values(template.resources);
  assert.deepEqual(modules.map(resource => resource.name).sort(), [
    'foundation-identities', 'foundation-key-vault', 'foundation-registry', 'foundation-role-assignments'
  ]);
  const allResources = modules.flatMap(resource => Object.values(resource.properties.template.resources));
  assert.ok(allResources.every(resource =>
    !resource.type.startsWith('Microsoft.App/') &&
    !resource.type.startsWith('Microsoft.DBforPostgreSQL/') &&
    resource.type !== 'Microsoft.KeyVault/vaults/secrets'
  ));
  const roleModule = modules.find(resource => resource.name === 'foundation-role-assignments');
  assert.deepEqual(roleModule.properties.parameters.appPrincipalIds.value, []);
  assert.deepEqual(roleModule.properties.parameters.secretPrincipalIds.value, []);
  const publisher = Object.values(roleModule.properties.template.resources)
    .find(resource => resource.name.includes('AcrPush'));
  assert.match(publisher.scope, /Microsoft.ContainerRegistry\/registries/);
  assert.equal(publisher.properties.principalId, "[parameters('deployerObjectId')]");
  assert.match(roleModule.properties.template.variables.acrPushRole, /8311e382-0749-4cb8-b61a-304f252e45ec/);
});

test('application identities and access exist before the apps that use them', () => {
  const template = getTemplate();
  const identities = template.resources.identities;
  const roles = template.resources.roleAssignments;
  const apps = template.resources.apps;
  assert.equal(template.parameters.deployApplications.defaultValue, false);
  assert.equal(apps.condition, "[parameters('deployApplications')]");
  assert.equal(template.outputs.containerAppNames.value, "[if(parameters('deployApplications'), reference('apps').outputs.names.value, createArray())]");
  assert.ok(roles.dependsOn.includes('identities'));
  assert.ok(apps.dependsOn.includes('roleAssignments'));
  assert.equal(roles.properties.parameters.appPrincipalIds.value, "[reference('identities').outputs.principalIds.value]");
  assert.equal(apps.properties.parameters.identityIds.value, "[reference('identities').outputs.ids.value]");

  const identityResources = Object.values(identities.properties.template.resources);
  assert.equal(identityResources[0].type, 'Microsoft.ManagedIdentity/userAssignedIdentities');
  const resources = Object.values(apps.properties.template.resources);
  const app = resources.find(resource => resource.type === 'Microsoft.App/containerApps');
  assert.equal(app.identity.type, 'UserAssigned');
  assert.match(Object.keys(app.identity.userAssignedIdentities)[0], /parameters\('identityIds'\)\[copyIndex\(\)\]/);
  for (const field of ['registries', 'secrets']) {
    assert.match(app.properties.configuration[field], /parameters\('identityIds'\)\[copyIndex\(\)\]/);
    assert.doesNotMatch(app.properties.configuration[field], /'system'/);
  }
  assert.equal(apps.properties.template.variables.services[1].name, 'api-gateway');
  const assignments = Object.values(roles.properties.template.resources);
  const secretAccess = assignments.find(resource => resource.copy?.name === 'appAccess');
  assert.equal(secretAccess.copy.count, "[length(parameters('secretPrincipalIds'))]");
  assert.deepEqual(roles.properties.parameters.secretPrincipalIds.value, [
    "[reference('identities').outputs.principalIds.value[0]]",
    "[reference('identities').outputs.principalIds.value[2]]",
    "[reference('identities').outputs.principalIds.value[3]]",
    "[reference('identities').outputs.principalIds.value[4]]"
  ]);
});

test('foundation access accepts existing identity principal IDs and grants the application roles', () => {
  const template = getTemplate('infra/foundation-access.bicep');
  const resources = Object.values(template.resources);
  assert.equal(resources.length, 1);
  assert.equal(resources[0].name, 'foundation-application-access');
  const params = resources[0].properties.parameters;
  assert.equal(template.parameters.appPrincipalIds.minLength, 5);
  assert.equal(template.parameters.appPrincipalIds.maxLength, 5);
  assert.equal(params.appPrincipalIds.value, "[parameters('appPrincipalIds')]");
  assert.deepEqual(params.secretPrincipalIds.value, [0, 2, 3, 4].map(
    index => `[parameters('appPrincipalIds')[${index}]]`
  ));
});
