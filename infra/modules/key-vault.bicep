param name string
param location string
param tags object
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
output id string = vault.id
output vaultUri string = vault.properties.vaultUri
