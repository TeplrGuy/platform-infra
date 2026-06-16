@description('Primary deployment location')
param location string

@description('Resource name prefix')
param prefix string

@description('Environment name')
param environmentName string

param appServicePlanName string
param appServicePlanSku string
param logAnalyticsName string
param appInsightsName string
param keyVaultName string
param serviceBusNamespaceName string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForTemplateDeployment: false
    enabledForDiskEncryption: false
    softDeleteRetentionInDays: 90
    enableSoftDelete: true
    publicNetworkAccess: 'Enabled'
  }
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2023-01-01-preview' = {
  name: serviceBusNamespaceName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: appServicePlanSku
    tier: contains(['F1', 'D1', 'B1', 'B2', 'B3'], appServicePlanSku) ? 'Basic' : 'PremiumV3'
    capacity: 1
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

var appNames = [
  '${prefix}-${environmentName}-api-gateway'
  '${prefix}-${environmentName}-orders-service'
  '${prefix}-${environmentName}-inventory-service'
  '${prefix}-${environmentName}-notifications-service'
]

resource webApps 'Microsoft.Web/sites@2023-12-01' = [for appName in appNames: {
  name: appName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'SERVICEBUS_NAMESPACE'
          value: serviceBus.name
        }
        {
          name: 'KEYVAULT_URI'
          value: keyVault.properties.vaultUri
        }
        {
          name: 'ENVIRONMENT_NAME'
          value: environmentName
        }
      ]
    }
  }
}]

output appServicePlanId string = appServicePlan.id
