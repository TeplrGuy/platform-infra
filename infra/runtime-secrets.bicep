targetScope = 'resourceGroup'

@secure()
param postgresAdminPassword string

resource vault 'Microsoft.KeyVault/vaults@2026-05-15' existing = {
  name: 'kv-agentsdlc-dev-7c77'
}

resource password 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'postgres-admin-password'
  properties: {
    value: postgresAdminPassword
  }
}
