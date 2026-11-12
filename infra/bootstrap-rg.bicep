targetScope = 'subscription'

param location string = 'northeurope'
param resourceGroupName string = 'agtsdlc-dev-rg'
param sessionId string = '55eb0364-fed8-4fc9-95e3-405ad428b06d'
param createdAt string = '2026-11-11T15:43:42.2240991-05:00'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2026-06-01' = {
  name: resourceGroupName
  location: location
  tags: {
    'app-onboard-skill': 'true'
    'app-onboard-session-id': sessionId
    'created-at': createdAt
    environment: 'agentsdlc-dev-55eb'
    'deployed-by': 'github-actions'
  }
}

output resourceGroupId string = resourceGroup.id
