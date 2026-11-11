const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('public ingress is opt-in and requires application authentication', () => {
  const options = { cwd: path.join(__dirname, '..'), encoding: 'utf8' };
  const result = process.platform === 'win32'
    ? spawnSync('az bicep build --file infra/main.bicep --stdout', { ...options, shell: true })
    : spawnSync('az', ['bicep', 'build', '--file', 'infra/main.bicep', '--stdout'], options);
  assert.equal(result.status, 0, result.stderr || result.error?.message);

  const template = JSON.parse(result.stdout);
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
});
