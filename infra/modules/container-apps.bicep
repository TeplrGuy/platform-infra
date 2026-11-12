param environmentId string
param environmentDefaultDomain string
param registryLoginServer string
param appInsightsConnectionString string
param keyVaultUri string
param appNames array
param identityIds array
param containerImage string
param containerImages object
param isPlaceholder bool
param enablePublicIngress bool
param environmentName string
param enableEntraAuth bool
param tags object
param entraClientId string
param entraTenantId string

var services = [
  { name: 'portal-web', imageKey: 'portal', external: true, minReplicas: 0 }
  { name: 'api-gateway', imageKey: 'apiGateway', external: false, minReplicas: 0 }
  { name: 'orders-service', imageKey: 'orders', external: false, minReplicas: 0 }
  { name: 'inventory-service', imageKey: 'inventory', external: false, minReplicas: 0 }
  { name: 'notifications-service', imageKey: 'notifications', external: false, minReplicas: 0 }
]
var names = appNames
var databaseUrlSecret = 'postgres-database-url'
var entraSecret = 'entra-client-secret'

resource apps 'Microsoft.App/containerApps@2026-07-01' = [
  for (service, i) in services: {
    name: names[i]
    location: resourceGroup().location
    tags: tags
    identity: {
      type: 'UserAssigned'
      userAssignedIdentities: {
        '${identityIds[i]}': {}
      }
    }
    properties: {
      managedEnvironmentId: environmentId
      configuration: {
        activeRevisionsMode: 'Single'
        ingress: {
          external: service.external && enablePublicIngress && !isPlaceholder && enableEntraAuth
          targetPort: 3000
          transport: 'auto'
        }
        registries: isPlaceholder
          ? []
          : [
              { server: registryLoginServer, identity: identityIds[i] }
            ]
        secrets: isPlaceholder
          ? []
          : concat(
              contains(['orders-service', 'inventory-service', 'notifications-service'], service.name)
                ? [
                    {
                      name: databaseUrlSecret
                      keyVaultUrl: concat(keyVaultUri, 'secrets/', databaseUrlSecret)
                      identity: identityIds[i]
                    }
                  ]
                : [],
              service.name == 'portal-web' && enableEntraAuth
                ? [
                    { name: entraSecret, keyVaultUrl: concat(keyVaultUri, 'secrets/', entraSecret), identity: identityIds[i] }
                  ]
                : []
            )
      }
      template: {
        containers: [
          {
            name: service.name
            image: isPlaceholder ? containerImage : containerImages[service.imageKey]
            resources: {
              cpu: json('0.5')
              memory: '1Gi'
            }
            env: concat(
              [
                { name: 'PORT', value: '3000' }
                { name: 'ENVIRONMENT_NAME', value: environmentName }
                { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
                { name: 'OTEL_SERVICE_NAME', value: service.name }
              ],
              service.name == 'portal-web'
                ? [
                    { name: 'API_GATEWAY_URL', value: concat('https://', names[1], '.internal.', environmentDefaultDomain) }
                  ]
                : [],
              service.name == 'api-gateway'
                ? [
                    { name: 'ORDERS_SERVICE_URL', value: concat('https://', names[2], '.internal.', environmentDefaultDomain) }
                    { name: 'INVENTORY_SERVICE_URL', value: concat('https://', names[3], '.internal.', environmentDefaultDomain) }
                  ]
                : [],
              service.name == 'orders-service'
                ? [
                    { name: 'INVENTORY_SERVICE_URL', value: concat('https://', names[3], '.internal.', environmentDefaultDomain) }
                    {
                      name: 'NOTIFICATIONS_SERVICE_URL'
                      value: concat('https://', names[4], '.internal.', environmentDefaultDomain)
                    }
                  ]
                : [],
              contains(['orders-service', 'inventory-service', 'notifications-service'], service.name) && !isPlaceholder
                ? [
                    { name: 'DATABASE_URL', secretRef: databaseUrlSecret }
                  ]
                : []
            )
            probes: [
              {
                type: 'Liveness'
                httpGet: { path: '/health', port: 3000 }
                initialDelaySeconds: 20
                periodSeconds: 10
              }
              {
                type: 'Readiness'
                httpGet: { path: '/health', port: 3000 }
                initialDelaySeconds: 15
                periodSeconds: 10
              }
              {
                type: 'Startup'
                httpGet: { path: '/health', port: 3000 }
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
  }
]

resource portalApp 'Microsoft.App/containerApps@2026-07-01' existing = {
  name: names[0]
}

resource portalAuth 'Microsoft.App/containerApps/authConfigs@2025-01-01' = if (!isPlaceholder && enableEntraAuth) {
  name: 'current'
  parent: portalApp
  dependsOn: [
    apps
  ]
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: entraClientId
          clientSecretSettingName: entraSecret
          openIdIssuer: 'https://login.microsoftonline.com/${entraTenantId}/v2.0'
        }
      }
    }
  }
}

output names array = names
