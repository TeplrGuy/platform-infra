targetScope = 'resourceGroup'

@secure()
param postgresAdminPassword string

var names = loadJsonContent('main.parameters.json').parameters.resourceNames.value

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01' existing = {
  name: names.postgres
}

resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'uuid-ossp,pgcrypto,pg_trgm'
    source: 'user-override'
  }
}

module secrets 'modules/application-secrets.bicep' = {
  name: 'runtime-recovery-database-url'
  params: {
    keyVaultName: names.keyVault
    databaseUrl: 'postgresql://agenticsadmin:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/agenticsdldemo?sslmode=require'
    entraClientSecret: ''
    enableEntraAuth: false
  }
}
