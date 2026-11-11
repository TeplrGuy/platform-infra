param keyVaultName string
@secure()
param databaseUrl string
@secure()
param entraClientSecret string
param enableEntraAuth bool

resource vault 'Microsoft.KeyVault/vaults@2026-05-15' existing = {
  name: keyVaultName
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
