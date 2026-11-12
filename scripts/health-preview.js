const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const foundation = require('../infra/foundation.parameters.json').parameters;
const release = require('../infra/private-release.json');

const root = '/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg/providers/';
const jobId = `${root}Microsoft.App/jobs/job-agentsdlc-dev-55eb-health`;
const environmentId = `${root}Microsoft.App/managedEnvironments/cae-agentsdlc-dev-55eb`;
const identityId = `${root}Microsoft.ManagedIdentity/userAssignedIdentities/${foundation.appNames.value[0]}-identity`;
const image = `cragentsdlcdev55eb.azurecr.io/${release.services[0].name}@${release.services[0].digest}`;

function validate(preview, domain, source) {
  if (!/^[a-z0-9-]+\.northeurope\.azurecontainerapps\.io$/.test(domain) ||
      preview?.status !== 'Succeeded' || !Array.isArray(preview.changes)) throw Error('Health job preview is incomplete.');
  let job;
  const seen = new Set();
  for (const change of preview.changes) {
    const id = change?.resourceId?.toLowerCase();
    if (!id || !id.startsWith(root.toLowerCase()) || seen.has(id)) throw Error('Duplicate or out-of-scope preview resource.');
    seen.add(id);
    if (change.changeType === 'Ignore') continue;
    if (id !== jobId.toLowerCase() || change.changeType !== 'Create' ||
        change.after?.id?.toLowerCase() !== id || change.after?.type?.toLowerCase() !== 'microsoft.app/jobs') {
      throw Error('Only initial creation of the private health job is allowed.');
    }
    job = change.after;
  }
  if (!job || job.location !== 'northeurope' || job.identity?.type !== 'UserAssigned' ||
      !isDeepStrictEqual(Object.keys(job.identity.userAssignedIdentities || {}).map(x => x.toLowerCase()), [identityId.toLowerCase()]) ||
      job.properties?.environmentId?.toLowerCase() !== environmentId.toLowerCase()) throw Error('Health job scope or identity changed.');
  for (const [key, value] of Object.entries(foundation.tags.value)) {
    if (job.tags?.[key] !== value) throw Error('Health job tags changed.');
  }
  const config = job.properties.configuration;
  if (config?.triggerType !== 'Manual' || config.replicaRetryLimit !== 0 || config.replicaTimeout !== 600 ||
      config.manualTriggerConfig?.parallelism !== 1 || config.manualTriggerConfig.replicaCompletionCount !== 1 ||
      config.registries?.length !== 1 || config.registries[0].server !== 'cragentsdlcdev55eb.azurecr.io' ||
      config.registries[0].identity?.toLowerCase() !== identityId.toLowerCase() ||
      (config.secrets || []).length) throw Error('Health job execution configuration changed.');
  const containers = job.properties.template?.containers;
  const template = job.properties.template;
  const ref = `[reference('${environmentId}', '2026-07-01').defaultDomain]`;
  if (containers?.length !== 1 || containers[0].name !== 'private-health' || containers[0].image !== image ||
      !isDeepStrictEqual(containers[0].command, ['node', '-e', source]) ||
      (containers[0].args || []).length || (containers[0].volumeMounts || []).length ||
      (template.initContainers || []).length || (template.volumes || []).length ||
      containers[0].resources?.cpu !== 0.5 || containers[0].resources?.memory !== '1Gi') {
    throw Error('Health job image or probe code changed.');
  }
  const env = containers[0].env || [];
  if (env.length !== 2 || !env.some(item => isDeepStrictEqual(item, { name: 'PRIVATE_HEALTH_RUN', value: 'true' })) ||
      !env.some(item => [domain, ref].some(value => isDeepStrictEqual(item, { name: 'ACA_DOMAIN', value })))) {
    throw Error('Health job environment changed.');
  }
  return job;
}

if (require.main === module) {
  try {
    const [previewFile, domain, approvedFile] = process.argv.slice(2);
    if (!previewFile || !domain) throw Error('Usage: health-preview.js <preview> <domain> [approved-preview]');
    const read = file => JSON.parse(readFileSync(file, 'utf8'));
    const source = readFileSync('scripts/private-health.js', 'utf8');
    const current = validate(read(previewFile), domain, source);
    if (approvedFile && !isDeepStrictEqual(current, validate(read(approvedFile), domain, source))) {
      throw Error('Health job preview changed after approval.');
    }
    console.log('Private health job preview matches the approved scope.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validate };
