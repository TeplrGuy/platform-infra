const assert = require('node:assert/strict');
const test = require('node:test');
const { createParameters } = require('../scripts/foundation-access-parameters');

const ids = [1, 2, 3, 4, 5].map(i => `00000000-0000-0000-0000-00000000000${i}`);

test('requires five distinct identity IDs and preserves service order', () => {
  assert.deepEqual(createParameters(ids).parameters.appPrincipalIds.value, ids);
  assert.throws(() => createParameters(ids.slice(1)), /five distinct/);
  assert.throws(() => createParameters([...ids.slice(0, 4), ids[0]]), /five distinct/);
  assert.throws(() => createParameters([...ids.slice(0, 4), 'invalid']), /five distinct/);
});
