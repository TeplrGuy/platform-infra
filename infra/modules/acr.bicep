param name string
param location string
param tags object
resource registry 'Microsoft.ContainerRegistry/registries@2026-11-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
output id string = registry.id
output loginServer string = registry.properties.loginServer
