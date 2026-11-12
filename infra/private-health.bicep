targetScope = 'resourceGroup'

var names = loadJsonContent('main.parameters.json').parameters.resourceNames.value
var foundation = loadJsonContent('foundation.parameters.json').parameters
var release = loadJsonContent('private-release.json')
var identityId = resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', '${foundation.appNames.value[0]}-identity')

resource environment 'Microsoft.App/managedEnvironments@2026-07-01' existing = {
  name: names.environment
}

resource job 'Microsoft.App/jobs@2026-07-01' = {
  name: 'job-agentsdlc-dev-7c77-health'
  location: resourceGroup().location
  tags: foundation.tags.value
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Manual'
      replicaRetryLimit: 0
      replicaTimeout: 600
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: 'cragentsdlcdev7c77.azurecr.io'
          identity: identityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'private-health'
          image: 'cragentsdlcdev7c77.azurecr.io/${release.services[0].name}@${release.services[0].digest}'
          command: [
            'node'
            '-e'
            loadTextContent('../scripts/private-health.js')
          ]
          env: [
            { name: 'PRIVATE_HEALTH_RUN', value: 'true' }
            { name: 'ACA_DOMAIN', value: environment.properties.defaultDomain }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}
