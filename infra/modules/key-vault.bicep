param name string
param location string
param tags object
@secure()
param databaseUrl string
@secure()
param entraClientSecret string
param enableEntraAuth bool
resource vault 'Microsoft.KeyVault/vaults@2026-05-15' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}
resource databaseSecret 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'postgres-database-url'
  properties: { value: databaseUrl }
}
resource entraSecret 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = if (enableEntraAuth) {
  parent: vault
  name: 'entra-client-secret'
  properties: { value: entraClientSecret }
}
output id string = vault.id
output vaultUri string = vault.properties.vaultUri
