targetScope = 'resourceGroup'

@secure()
param postgresAdminPassword string

var names = loadJsonContent('main.parameters.json').parameters.resourceNames.value
var tags = loadJsonContent('foundation.parameters.json').parameters.tags.value
var location = 'northeurope'

module logs 'modules/log-analytics.bicep' = {
  name: 'runtime-logs'
  params: {
    name: names.logAnalytics
    location: location
    tags: tags
  }
}

module insights 'modules/app-insights.bicep' = {
  name: 'runtime-insights'
  params: {
    name: names.appInsights
    location: location
    workspaceResourceId: logs.outputs.id
    tags: tags
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'runtime-postgres'
  params: {
    name: names.postgres
    location: location
    administratorLogin: 'agenticsadmin'
    administratorLoginPassword: postgresAdminPassword
    databaseName: 'agenticsdldemo'
    tags: tags
  }
}

module secrets 'modules/application-secrets.bicep' = {
  name: 'runtime-database-url'
  params: {
    keyVaultName: names.keyVault
    databaseUrl: 'postgresql://agenticsadmin:${uriComponent(postgresAdminPassword)}@${postgres.outputs.fullyQualifiedDomainName}:5432/agenticsdldemo?sslmode=require'
    entraClientSecret: ''
    enableEntraAuth: false
  }
}

module environment 'modules/container-environment.bicep' = {
  name: 'runtime-environment'
  params: {
    name: names.environment
    location: location
    logAnalyticsCustomerId: logs.outputs.customerId
    logAnalyticsSharedKey: logs.outputs.sharedKey
    tags: tags
  }
}

output postgresFqdn string = postgres.outputs.fullyQualifiedDomainName
output environmentId string = environment.outputs.id
output environmentDefaultDomain string = environment.outputs.defaultDomain
output appInsightsId string = insights.outputs.id
