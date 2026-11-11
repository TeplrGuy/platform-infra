targetScope = 'resourceGroup'

param location string
param tags object
param registryName string
param keyVaultName string
@minLength(5)
@maxLength(5)
param appNames array
param deployerObjectId string

module registry 'modules/acr.bicep' = {
  name: 'foundation-registry'
  params: {
    name: registryName
    location: location
    tags: tags
  }
}
module keyVault 'modules/key-vault.bicep' = {
  name: 'foundation-key-vault'
  params: {
    name: keyVaultName
    location: location
    tags: tags
  }
}
module identities 'modules/managed-identities.bicep' = {
  name: 'foundation-identities'
  params: {
    appNames: appNames
    location: location
    tags: tags
  }
}
module roleAssignments 'modules/role-assignments.bicep' = {
  name: 'foundation-role-assignments'
  params: {
    keyVaultId: keyVault.outputs.id
    registryId: registry.outputs.id
    deployerObjectId: deployerObjectId
    appPrincipalIds: identities.outputs.principalIds
    secretPrincipalIds: [
      identities.outputs.principalIds[0]
      identities.outputs.principalIds[2]
      identities.outputs.principalIds[3]
      identities.outputs.principalIds[4]
    ]
  }
}

output registryLoginServer string = registry.outputs.loginServer
output keyVaultUri string = keyVault.outputs.vaultUri
