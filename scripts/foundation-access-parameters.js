function createParameters(principalIds) {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (principalIds.length !== 5 || principalIds.some(id => !guid.test(id)) ||
      new Set(principalIds.map(id => id.toLowerCase())).size !== 5) {
    throw new Error('Exactly five distinct managed identity principal IDs are required.');
  }
  return {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
    contentVersion: '1.0.0.0',
    parameters: {
      registryName: { value: 'cragentsdlcdev55eb' },
      keyVaultName: { value: 'kv-agentsdlc-dev-55eb' },
      deployerObjectId: { value: 'b6a3c39d-0263-4f01-b975-654cdea443a0' },
      appPrincipalIds: { value: [...principalIds] }
    }
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(createParameters(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createParameters };
