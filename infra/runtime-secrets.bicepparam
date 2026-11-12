using './runtime-secrets.bicep'

param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
