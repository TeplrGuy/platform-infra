targetScope = 'resourceGroup'

@description('Entra application registration used by the portal built-in authentication provider.')
param entraClientId string
@description('The Entra tenant that owns the portal application registration.')
param entraTenantId string
@secure()
@description('Client secret for the portal application registration; supplied through the protected workflow environment.')
param entraClientSecret string

var names = loadJsonContent('main.parameters.json').parameters.resourceNames.value
var foundation = loadJsonContent('foundation.parameters.json').parameters
var release = loadJsonContent('private-release.json')
var appNames = foundation.appNames.value
var identityIds = [for name in appNames: resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', '${name}-identity')]
var containerImages = {
  portal: 'cragentsdlcdev7c77.azurecr.io/${release.services[0].name}@${release.services[0].digest}'
  apiGateway: 'cragentsdlcdev7c77.azurecr.io/${release.services[1].name}@${release.services[1].digest}'
  orders: 'cragentsdlcdev7c77.azurecr.io/${release.services[2].name}@${release.services[2].digest}'
  inventory: 'cragentsdlcdev7c77.azurecr.io/${release.services[3].name}@${release.services[3].digest}'
  notifications: 'cragentsdlcdev7c77.azurecr.io/${release.services[4].name}@${release.services[4].digest}'
}

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

resource entraSecret 'Microsoft.KeyVault/vaults/secrets@2026-05-15' = {
  parent: vault
  name: 'entra-client-secret'
  properties: {
    value: entraClientSecret
    contentType: 'text/plain'
  }
}

module apps 'modules/container-apps.bicep' = {
  name: 'public-workloads'
  dependsOn: [
    entraSecret
  ]
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
    enablePublicIngress: true
    environmentName: foundation.tags.value.environment
    enableEntraAuth: true
    tags: foundation.tags.value
    entraClientId: entraClientId
    entraTenantId: entraTenantId
  }
}

output portalUrl string = concat('https://', appNames[0], '.', environment.properties.defaultDomain)
output portalCallbackUri string = concat(
  'https://',
  appNames[0],
  '.',
  environment.properties.defaultDomain,
  '/.auth/login/aad/callback'
)
