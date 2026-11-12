targetScope = 'resourceGroup'

param registryName string
param keyVaultName string
@minLength(5)
@maxLength(5)
param appPrincipalIds array
param deployerObjectId string

module roleAssignments 'modules/role-assignments.bicep' = {
  name: 'foundation-application-access'
  params: {
    keyVaultId: resourceId('Microsoft.KeyVault/vaults', keyVaultName)
    registryId: resourceId('Microsoft.ContainerRegistry/registries', registryName)
    deployerObjectId: deployerObjectId
    appPrincipalIds: appPrincipalIds
    secretPrincipalIds: [
      appPrincipalIds[0]
      appPrincipalIds[2]
      appPrincipalIds[3]
      appPrincipalIds[4]
    ]
  }
}
