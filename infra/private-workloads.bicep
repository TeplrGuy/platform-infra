targetScope = 'resourceGroup'

param containerImages object

var names = loadJsonContent('main.parameters.json').parameters.resourceNames.value
var foundation = loadJsonContent('foundation.parameters.json').parameters
var appNames = foundation.appNames.value
var identityIds = [for name in appNames: resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', '${name}-identity')]
var runtimePostgresPassword = 'Aa0_PreviewOnly_NotAnActualCredential7c770123456789'

resource environment 'Microsoft.App/managedEnvironments@2026-07-01' existing = {
  name: names.environment
}

resource insights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: names.appInsights
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: names.registry
}

resource vault 'Microsoft.KeyVault/vaults@2026-05-15' existing = {
  name: names.keyVault
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' existing = {
  name: names.postgres
}

module apps 'modules/container-apps.bicep' = {
  name: 'private-workloads'
  params: {
    environmentId: environment.id
    environmentDefaultDomain: environment.properties.defaultDomain
    registryLoginServer: registry.properties.loginServer
    appInsightsConnectionString: insights.properties.ConnectionString
    keyVaultUri: vault.properties.vaultUri
    appNames: appNames
    identityIds: identityIds
    containerImage: ''
    containerImages: containerImages
    isPlaceholder: false
    enablePublicIngress: false
    environmentName: foundation.tags.value.environment
    enableEntraAuth: false
    tags: foundation.tags.value
    entraClientId: ''
    entraTenantId: subscription().tenantId
    databaseUrl: 'postgresql://agenticsadmin:${uriComponent(runtimePostgresPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/agenticsdldemo?sslmode=require'
  }
}

output appNames array = apps.outputs.names
