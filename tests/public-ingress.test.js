const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

let compiledTemplate;
function getTemplate() {
  if (compiledTemplate) return compiledTemplate;
  const options = { cwd: path.join(__dirname, '..'), encoding: 'utf8' };
  const result = process.platform === 'win32'
    ? spawnSync('az bicep build --file infra/main.bicep --stdout', { ...options, shell: true })
    : spawnSync('az', ['bicep', 'build', '--file', 'infra/main.bicep', '--stdout'], options);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  compiledTemplate = JSON.parse(result.stdout);
  return compiledTemplate;
}

test('public ingress is opt-in and requires application authentication', () => {
  const template = getTemplate();
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
