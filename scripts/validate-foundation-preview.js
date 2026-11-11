const fs = require('node:fs');

function validate(preview) {
  if (preview.status !== 'Succeeded' || !Array.isArray(preview.changes) || preview.changes.length === 0) {
    throw new Error('Foundation preview is incomplete or unsuccessful.');
  }
  const unsupported = preview.changes.filter(change => change.changeType === 'Unsupported');
  if (unsupported.length) {
    throw new Error(`Foundation preview contains ${unsupported.length} unsupported change(s); do not apply.`);
  }
}

if (require.main === module) {
  try {
    validate(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    console.log('Foundation preview has no unsupported changes; manual scope review is still required.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { validate };
