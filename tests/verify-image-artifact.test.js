const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { verifyArchive, verifyLoaded } = require('../scripts/verify-image-artifact');

const repos = ['portal-web', 'api-gateway', 'orders-service', 'inventory-service', 'notifications-service'];
const keys = ['PORTAL_REF', 'GATEWAY_REF', 'ORDERS_REF', 'INVENTORY_REF', 'NOTIFICATIONS_REF'];
const revision = 'a'.repeat(40);
const expected = Object.fromEntries(keys.map(key => [key, revision]));
const hash = data => createHash('sha256').update(data).digest('hex');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-images-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const archive = 'test archive';
  const manifest = repos.map((repo, i) => `${repo} ${revision} sha256:${String(i).repeat(64)}`).join('\n') + '\n';
  writeFileSync(join(dir, 'images.tar.gz'), archive);
  writeFileSync(join(dir, 'images.txt'), manifest);
  writeFileSync(join(dir, 'SHA256SUMS'), `${hash(archive)}  images.tar.gz\n${hash(manifest)}  images.txt\n`);
  return dir;
}

test('verifies checksums, approved source revisions and loaded image IDs', async t => {
  const images = await verifyArchive(fixture(t), expected);
  verifyLoaded(images, '123', tag => images.get(tag.split('/')[1].split(':')[0]).imageId);
  assert.throws(() => verifyLoaded(images, '123', () => `sha256:${'f'.repeat(64)}`), /does not match/);
  assert.throws(() => verifyLoaded(images, '../123', () => ''), /Invalid source run ID/);
  assert.throws(() => verifyLoaded(new Map(), '123', () => ''), /All five images/);
});

test('rejects tampering and incorrect source revisions', async t => {
  const dir = fixture(t);
  await assert.rejects(verifyArchive(dir, { ...expected, ORDERS_REF: 'b'.repeat(40) }), /approved source revisions/);
  writeFileSync(join(dir, 'images.tar.gz'), 'different archive');
  await assert.rejects(verifyArchive(dir, expected), /Checksum mismatch/);
});

test('rejects unsafe and incomplete checksum lists', async t => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'SHA256SUMS'), `${'0'.repeat(64)}  ../images.txt\n`);
  await assert.rejects(verifyArchive(dir, expected), /Invalid or duplicate/);
});
