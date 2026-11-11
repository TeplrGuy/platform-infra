targetScope = 'subscription'

param location string = 'northeurope'
param environmentName string = 'agentsdlc-dev-55eb'
param sessionId string = '55eb0364-fed8-4fc9-95e3-405ad428b06d'
param deployedBy string
param createdAt string
param deployerObjectId string
@secure()
param postgresAdminPassword string
@secure()
param entraClientSecret string = ''
param entraClientId string = ''
param entraTenantId string = subscription().tenantId
param isPlaceholder bool = true
param deployApplications bool = false
param enablePublicIngress bool = false
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param containerImages object = {
  portal: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  apiGateway: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  orders: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  inventory: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  notifications: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
}
param resourceNames object = {
  resourceGroup: 'agtsdlc-dev-rg'
  environment: 'cae-agentsdlc-dev-55eb'
  portal: 'ca-agentsdlc-dev-55eb-portal'
  apiGateway: 'ca-agentsdlc-dev-55eb-apigw'
  orders: 'ca-agentsdlc-dev-55eb-orders'
  inventory: 'ca-agentsdlc-dev-55eb-inventory'
  notifications: 'ca-agentsdlc-dev-55eb-notify'
  registry: 'cragentsdlcdev55eb'
  postgres: 'pg-agentsdlc-dev-55eb'
  keyVault: 'kv-agentsdlc-dev-55eb'
  logAnalytics: 'log-agentsdlc-dev-55eb'
  appInsights: 'appi-agentsdlc-dev-55eb'
}

var rgName = resourceNames.resourceGroup
var enableEntraAuth = !empty(entraClientId) && !empty(entraClientSecret)
var appNames = [
  resourceNames.portal
  resourceNames.apiGateway
  resourceNames.orders
  resourceNames.inventory
  resourceNames.notifications
]
var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

resource rg 'Microsoft.Resources/resourceGroups@2026-06-01' = {
  name: rgName
  location: location
  tags: tags
}

module logAnalytics 'modules/log-analytics.bicep' = {
  scope: rg
  name: 'log-analytics'
  params: {
    name: resourceNames.logAnalytics
    location: location
    tags: tags
  }
}

module appInsights 'modules/app-insights.bicep' = {
  scope: rg
  name: 'application-insights'
  params: {
    name: resourceNames.appInsights
    location: location
    workspaceResourceId: logAnalytics.outputs.id
    tags: tags
  }
}

module registry 'modules/acr.bicep' = {
  scope: rg
  name: 'container-registry'
  params: {
    name: resourceNames.registry
    location: location
    tags: tags
  }
}

module postgres 'modules/postgres.bicep' = {
  scope: rg
  name: 'postgresql'
  params: {
    name: resourceNames.postgres
    location: location
    administratorLogin: 'agenticsadmin'
    administratorLoginPassword: postgresAdminPassword
    databaseName: 'agenticsdldemo'
    tags: tags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  scope: rg
  name: 'key-vault'
  params: {
    name: resourceNames.keyVault
    location: location
    tags: tags
  }
}

module applicationSecrets 'modules/application-secrets.bicep' = {
  scope: rg
  name: 'application-secrets'
  dependsOn: [
    keyVault
  ]
  params: {
    keyVaultName: resourceNames.keyVault
    databaseUrl: concat(
      'postgresql://',
      'agenticsadmin:',
      uriComponent(postgresAdminPassword),
      '@',
      postgres.outputs.fullyQualifiedDomainName,
      ':5432/agenticsdldemo?sslmode=require'
    )
    entraClientSecret: entraClientSecret
    enableEntraAuth: enableEntraAuth
  }
}

module environment 'modules/container-environment.bicep' = {
  scope: rg
  name: 'container-apps-environment'
  params: {
    name: resourceNames.environment
    location: location
    logAnalyticsCustomerId: logAnalytics.outputs.customerId
    logAnalyticsSharedKey: logAnalytics.outputs.sharedKey
    tags: tags
  }
}

module identities 'modules/managed-identities.bicep' = {
  scope: rg
  name: 'application-identities'
  params: {
    appNames: appNames
    location: location
    tags: tags
  }
}

module roleAssignments 'modules/role-assignments.bicep' = {
  scope: rg
  name: 'role-assignments'
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

module apps 'modules/container-apps.bicep' = if (deployApplications) {
  scope: rg
  name: 'container-apps'
  dependsOn: [
    applicationSecrets
    roleAssignments
  ]
  params: {
    environmentId: environment.outputs.id
    environmentDefaultDomain: environment.outputs.defaultDomain
    registryLoginServer: registry.outputs.loginServer
    appInsightsConnectionString: appInsights.outputs.connectionString
    keyVaultUri: keyVault.outputs.vaultUri
    appNames: appNames
    identityIds: identities.outputs.ids
    containerImage: containerImage
    containerImages: containerImages
    isPlaceholder: isPlaceholder
    enablePublicIngress: enablePublicIngress
    environmentName: environmentName
    enableEntraAuth: enableEntraAuth
    tags: tags
    entraClientId: entraClientId
    entraTenantId: entraTenantId
  }
}

output resourceGroupName string = rgName
output containerRegistryLoginServer string = registry.outputs.loginServer
output containerAppsEnvironmentId string = environment.outputs.id
output containerAppNames array = deployApplications ? apps.outputs.names : []
