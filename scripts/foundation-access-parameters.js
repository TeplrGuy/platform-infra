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
      registryName: { value: 'cragentsdlcdev7c77' },
      keyVaultName: { value: 'kv-agentsdlc-dev-7c77' },
      deployerObjectId: { value: '5be11849-e0f0-498e-9529-ef24f0c5c2d1' },
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
