const assert = require('node:assert/strict');
const test = require('node:test');
const { validate } = require('../scripts/validate-foundation-preview');

test('rejects incomplete or unsupported foundation previews', () => {
  assert.throws(() => validate({ status: 'Succeeded', changes: [] }), /incomplete/);
  assert.throws(() => validate({ status: 'Failed', changes: [{ changeType: 'Create' }] }), /unsuccessful/);
  assert.throws(() => validate({
    status: 'Succeeded',
    changes: [{ changeType: 'Create' }, { changeType: 'Unsupported' }]
  }), /unsupported/);
  assert.doesNotThrow(() => validate({ status: 'Succeeded', changes: [{ changeType: 'Create' }] }));
});
