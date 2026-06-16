targetScope = 'subscription'

@description('Primary deployment location')
param location string = 'westeurope'

@description('Environment name (dev/test/prod)')
param environmentName string

@description('Resource name prefix, lowercase, no spaces')
param prefix string

@description('App Service Plan SKU name')
param appServicePlanSku string = 'B1'

var rgName = '${prefix}-${environmentName}-rg'
var appServicePlanName = '${prefix}-${environmentName}-asp'
var logAnalyticsName = '${prefix}-${environmentName}-law'
var appInsightsName = '${prefix}-${environmentName}-appi'
var keyVaultName = toLower('${take(prefix, 12)}${environmentName}kv')
var serviceBusNamespaceName = toLower('${take(prefix, 18)}${environmentName}bus')

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
    appServicePlanName: appServicePlanName
    appServicePlanSku: appServicePlanSku
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
    keyVaultName: keyVaultName
    serviceBusNamespaceName: serviceBusNamespaceName
  }
}

output resourceGroupName string = rgName
output appServicePlanId string = platform.outputs.appServicePlanId
