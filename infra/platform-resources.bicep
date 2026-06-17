@description('Primary deployment location')
param location string

@description('Resource name prefix')
param prefix string

@description('Environment name')
param environmentName string

param logAnalyticsName string
param appInsightsName string
param keyVaultName string
param serviceBusNamespaceName string
param containerAppsEnvironmentName string
param containerRegistryName string

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

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: containerRegistryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

var services = [
  {
    name: 'api-gateway'
    appSuffix: 'apigw'
    external: true
    minReplicas: 1
  }
  {
    name: 'orders-service'
    appSuffix: 'orders'
    external: false
    minReplicas: 1
  }
  {
    name: 'inventory-service'
    appSuffix: 'inventory'
    external: false
    minReplicas: 0
  }
  {
    name: 'notifications-service'
    appSuffix: 'notify'
    external: false
    minReplicas: 0
  }
  {
    name: 'portal-web'
    appSuffix: 'portal'
    external: true
    minReplicas: 1
  }
]

var containerAppNames = [for service in services: '${prefix}-${environmentName}-${service.appSuffix}']
var keyVaultSecretsUserRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource containerApps 'Microsoft.App/containerApps@2024-03-01' = [for (service, i) in services: {
  name: containerAppNames[i]
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppsEnvironment.id
    configuration: {
      ingress: {
        external: service.external
        targetPort: 3000
        transport: 'auto'
      }
      activeRevisionsMode: 'Single'
    }
    template: {
      containers: [
        {
          name: service.name
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          env: [
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
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              initialDelaySeconds: 20
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              initialDelaySeconds: 15
              periodSeconds: 10
            }
            {
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: 3000
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 18
            }
          ]
        }
      ]
      scale: {
        minReplicas: service.minReplicas
        maxReplicas: 3
      }
    }
  }
}]

resource keyVaultSecretAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (appName, i) in containerAppNames: {
  scope: keyVault
  name: guid(keyVault.id, appName, 'keyvault-secrets-user')
  properties: {
    principalId: containerApps[i].identity.principalId
    roleDefinitionId: keyVaultSecretsUserRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}]

resource acrPullRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (appName, i) in containerAppNames: {
  scope: containerRegistry
  name: guid(containerRegistry.id, appName, 'acrpull')
  properties: {
    principalId: containerApps[i].identity.principalId
    roleDefinitionId: acrPullRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}]

output containerAppsEnvironmentId string = containerAppsEnvironment.id
output containerRegistryLoginServer string = containerRegistry.properties.loginServer
output containerAppNames array = containerAppNames
