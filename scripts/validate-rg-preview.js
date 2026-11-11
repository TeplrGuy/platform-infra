const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');

const expectedId = '/subscriptions/8fcc5e8e-6540-4288-89e7-849e94290205/resourceGroups/agtsdlc-dev-rg';
const expectedTags = {
  'app-onboard-session-id': '55eb0364-fed8-4fc9-95e3-405ad428b06d',
  'app-onboard-skill': 'true',
  'created-at': '2026-11-11T15:43:42.2240991-05:00',
  'deployed-by': 'github-actions',
  environment: 'agentsdlc-dev-55eb'
};

function validate(preview) {
  if (!Array.isArray(preview.changes) || preview.changes.length !== 1) {
    throw new Error('Expected exactly one resource-group creation in the preview.');
  }
  const change = preview.changes[0];
  const after = change.after;
  if (change.changeType !== 'Create' ||
      typeof change.resourceId !== 'string' ||
      change.resourceId.toLowerCase() !== expectedId.toLowerCase() ||
      !after || typeof after.id !== 'string' ||
      after.id.toLowerCase() !== expectedId.toLowerCase() ||
      after.name !== 'agtsdlc-dev-rg' ||
      after.type !== 'Microsoft.Resources/resourceGroups' ||
      after.location !== 'northeurope' ||
      !isDeepStrictEqual(after.tags, expectedTags)) {
    throw new Error('Preview does not match the approved resource-group creation.');
  }
  return after;
}

function validateAgainst(preview, approvedPreview) {
  const actual = validate(preview);
  const approved = validate(approvedPreview);
  if (!isDeepStrictEqual(actual, approved)) throw new Error('Resource-group preview changed after approval.');
}

if (require.main === module) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4) {
      throw new Error('Usage: node scripts/validate-rg-preview.js <preview.json> [approved-preview.json]');
    }
    const preview = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    if (process.argv[3]) {
      validateAgainst(preview, JSON.parse(readFileSync(process.argv[3], 'utf8')));
    } else {
      validate(preview);
    }
    console.log('Resource-group preview matches the approved scope and configuration.');
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validate, validateAgainst };
