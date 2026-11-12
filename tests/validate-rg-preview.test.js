const assert = require('node:assert/strict');
const test = require('node:test');
const { validate, validateAgainst } = require('../scripts/validate-rg-preview');

const id = '/subscriptions/b6f10878-9f8a-4b3f-8bc5-3464cdd79c77/resourceGroups/agtsdlc-dev-rg';
function preview() {
  return { changes: [{
    resourceId: id,
    changeType: 'Create',
    after: {
      id,
      name: 'agtsdlc-dev-rg',
      type: 'Microsoft.Resources/resourceGroups',
      location: 'northeurope',
      tags: {
        'app-onboard-session-id': '7c770364-fed8-4fc9-95e3-405ad428b06d',
        'app-onboard-skill': 'true',
        'created-at': '2026-11-11T15:43:42.2240991-05:00',
        'deployed-by': 'github-actions',
        environment: 'agentsdlc-dev-7c77'
      }
    }
  }] };
}

test('accepts only the approved resource-group creation', () => {
  assert.equal(validate(preview()).id, id);
  for (const change of [
    p => { p.changes.push(p.changes[0]); },
    p => { p.changes[0].resourceId = `${id}-other`; },
    p => { p.changes[0].changeType = 'Modify'; },
    p => { p.changes[0].after.location = 'swedencentral'; },
    p => { p.changes[0].after.tags.environment = 'other'; }
  ]) {
    const p = preview();
    change(p);
    assert.throws(() => validate(p));
  }
  assert.throws(() => validate({}));
});

test('rejects preview drift after approval', () => {
  const approved = preview();
  const changed = preview();
  validateAgainst(changed, approved);
  changed.changes[0].after.apiVersion = 'different-version';
  assert.throws(() => validateAgainst(changed, approved), /changed after approval/);
});
