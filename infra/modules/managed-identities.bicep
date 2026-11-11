param appNames array
param location string
param tags object

resource identities 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = [
  for appName in appNames: {
    name: '${appName}-identity'
    location: location
    tags: tags
  }
]

output ids array = [for (appName, i) in appNames: identities[i].id]
output principalIds array = [for (appName, i) in appNames: identities[i].properties.principalId]
