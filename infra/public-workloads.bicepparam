using './public-workloads.bicep'

param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID')
param entraTenantId = readEnvironmentVariable('ENTRA_TENANT_ID')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', 'PreviewOnly_NotARealClientSecret')
