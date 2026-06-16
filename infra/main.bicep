targetScope = 'subscription'

@description('Primary deployment location')
param location string = 'westeurope'

@description('Environment name (dev/test/prod)')
param environmentName string

@description('Resource name prefix, lowercase, no spaces')
param prefix string

var rgName = '${prefix}-${environmentName}-rg'
var logAnalyticsName = '${prefix}-${environmentName}-law'
var appInsightsName = '${prefix}-${environmentName}-appi'
var keyVaultName = toLower('${take(prefix, 12)}${environmentName}kv')
var serviceBusNamespaceName = toLower('${take(prefix, 18)}${environmentName}bus')
var containerAppsEnvironmentName = '${prefix}-${environmentName}-cae'
var containerRegistryName = toLower(replace('${take(prefix, 10)}${environmentName}acr', '-', ''))

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgName
  location: location
}

module platform 'platform-resources.bicep' = {
  scope: rg
  name: 'platform-resources'
  params: {
    location: location
    prefix: prefix
    environmentName: environmentName
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
    keyVaultName: keyVaultName
    serviceBusNamespaceName: serviceBusNamespaceName
    containerAppsEnvironmentName: containerAppsEnvironmentName
    containerRegistryName: containerRegistryName
  }
}

output resourceGroupName string = rgName
output containerAppsEnvironmentId string = platform.outputs.containerAppsEnvironmentId
output containerRegistryLoginServer string = platform.outputs.containerRegistryLoginServer
