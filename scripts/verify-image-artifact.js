const { createHash } = require('node:crypto');
const { createReadStream, lstatSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const refs = new Map([
  ['portal-web', 'PORTAL_REF'],
  ['api-gateway', 'GATEWAY_REF'],
  ['orders-service', 'ORDERS_REF'],
  ['inventory-service', 'INVENTORY_REF'],
  ['notifications-service', 'NOTIFICATIONS_REF']
]);

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyArchive(directory, expected) {
  for (const name of ['SHA256SUMS', 'images.txt', 'images.tar.gz']) {
    if (!lstatSync(join(directory, name)).isFile()) throw new Error(`Not a regular file: ${name}`);
  }
  const checksums = new Map();
  for (const line of readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (images\.tar\.gz|images\.txt)$/.exec(line);
    if (!match || checksums.has(match[2])) throw new Error('Invalid or duplicate artifact checksum.');
    checksums.set(match[2], match[1]);
  }
  if (checksums.size !== 2) throw new Error('Both artifact checksums are required.');
  for (const name of ['images.tar.gz', 'images.txt']) {
    if (await hashFile(join(directory, name)) !== checksums.get(name)) {
      throw new Error(`Checksum mismatch: ${name}`);
    }
  }
  const images = new Map();
  for (const line of readFileSync(join(directory, 'images.txt'), 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-z-]+) ([a-f0-9]{40}) (sha256:[a-f0-9]{64})$/.exec(line);
    if (!match || !refs.has(match[1]) || images.has(match[1]) || expected[refs.get(match[1])] !== match[2]) {
      throw new Error('Image manifest does not match the approved source revisions.');
    }
    images.set(match[1], { revision: match[2], imageId: match[3] });
  }
  if (images.size !== refs.size) throw new Error('Image manifest must contain all five services.');
  return images;
}

function verifyLoaded(images, runId, inspect) {
  if (!/^[1-9][0-9]*$/.test(runId)) throw new Error('Invalid source run ID.');
  if (images.size !== refs.size || [...refs.keys()].some(name => !images.has(name))) {
    throw new Error('All five images must be verified before inspecting them.');
  }
  for (const [name, image] of images) {
    const actual = inspect(`local-gate/${name}:${runId}`);
    if (actual !== image.imageId) throw new Error(`Loaded image ID does not match manifest: ${name}`);
  }
}

async function main() {
  const [, , mode, directory, sourceRunId] = process.argv;
  if (!['archive', 'loaded'].includes(mode) || !directory || !sourceRunId || process.argv.length !== 5) {
    throw new Error('Usage: node scripts/verify-image-artifact.js <archive|loaded> <directory> <source-run-id>');
  }
  const images = await verifyArchive(directory, process.env);
  if (mode === 'loaded') {
    verifyLoaded(images, sourceRunId, tag => {
      const result = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`Unable to inspect loaded image: ${tag}`);
      return result.stdout.trim();
    });
  } else if (!/^[1-9][0-9]*$/.test(sourceRunId)) {
    throw new Error('Invalid source run ID.');
  }
  console.log(`Verified ${images.size} image ${mode === 'archive' ? 'archive entries' : 'IDs'} against the approved revisions.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { verifyArchive, verifyLoaded };
