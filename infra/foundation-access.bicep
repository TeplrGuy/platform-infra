targetScope = 'resourceGroup'

param registryName string
param keyVaultName string
@minLength(5)
@maxLength(5)
param appNames array
param deployerObjectId string

resource identities 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = [
  for appName in appNames: {
    name: '${appName}-identity'
  }
]

var principalIds = [
  identities[0].properties.principalId
  identities[1].properties.principalId
  identities[2].properties.principalId
  identities[3].properties.principalId
  identities[4].properties.principalId
]

module roleAssignments 'modules/role-assignments.bicep' = {
  name: 'foundation-application-access'
  params: {
    keyVaultId: resourceId('Microsoft.KeyVault/vaults', keyVaultName)
    registryId: resourceId('Microsoft.ContainerRegistry/registries', registryName)
    deployerObjectId: deployerObjectId
    appPrincipalIds: principalIds
    secretPrincipalIds: [
      identities[0].properties.principalId
      identities[2].properties.principalId
      identities[3].properties.principalId
      identities[4].properties.principalId
    ]
  }
}
