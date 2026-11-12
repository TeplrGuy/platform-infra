param keyVaultId string
param registryId string
param deployerObjectId string
param appPrincipalIds array
param secretPrincipalIds array

var secretsOfficerRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
)
var secretsUserRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var acrPullRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
var acrPushRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '8311e382-0749-4cb8-b61a-304f252e45ec'
)

resource keyVault 'Microsoft.KeyVault/vaults@2026-05-15' existing = {
  name: last(split(keyVaultId, '/'))
}
resource registry 'Microsoft.ContainerRegistry/registries@2026-11-01' existing = {
  name: last(split(registryId, '/'))
}

resource deployer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVaultId, deployerObjectId, 'KeyVaultSecretsOfficer')
  scope: keyVault
  properties: {
    principalId: deployerObjectId
    roleDefinitionId: secretsOfficerRole
    principalType: 'ServicePrincipal'
  }
}
resource deployerPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registryId, deployerObjectId, 'AcrPush')
  scope: registry
  properties: {
    principalId: deployerObjectId
    roleDefinitionId: acrPushRole
    principalType: 'ServicePrincipal'
  }
}

resource appAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in secretPrincipalIds: {
    name: guid(keyVaultId, principalId, 'KeyVaultSecretsUser')
    scope: keyVault
    properties: {
      principalId: principalId
      roleDefinitionId: secretsUserRole
      principalType: 'ServicePrincipal'
    }
  }
]
resource registryPullAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (principalId, i) in appPrincipalIds: {
    name: guid(registryId, principalId, 'AcrPull')
    scope: registry
    properties: {
      principalId: principalId
      roleDefinitionId: acrPullRole
      principalType: 'ServicePrincipal'
    }
  }
]
