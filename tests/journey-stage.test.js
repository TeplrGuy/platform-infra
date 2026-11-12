const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('protected journey runs one create and read-only verification only after scale-to-zero', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-stage-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.mkdirSync(path.join(tmp, 'bin'));
    fs.mkdirSync(path.join(tmp, 'infra'));
    fs.copyFileSync('infra/private-release.json', path.join(tmp, 'infra/private-release.json'));
    fs.copyFileSync('scripts/journey-stage.sh', path.join(tmp, 'scripts/journey-stage.sh'));
    fs.copyFileSync('scripts/private-journey.js', path.join(tmp, 'scripts/private-journey.js'));
    const write = (file, content) => {
      fs.writeFileSync(path.join(tmp, file), content);
      fs.chmodSync(path.join(tmp, file), 0o755);
    };
    write('scripts/health-stage.sh', `#!/usr/bin/env bash
[[ "$1" == verify ]] || exit 1
echo example-1234.northeurope.azurecontainerapps.io > health-domain.txt
echo '{"properties":{"template":{"containers":[{"image":"pinned-image"}]}}}' > health-live.json
`);
    write('bin/az', `#!/usr/bin/env bash
case "$1 $2 $3" in
  'containerapp show --name')
    if [[ "$*" == *"containers[0].image"* ]]; then
      node -e 'const r=require("./infra/private-release.json");const name=process.argv[1].split("-").at(-1);const keys={portal:"portal",apigw:"apiGateway",orders:"orders",inventory:"inventory",notify:"notifications"};const s=r.services.find(x=>x.key===keys[name]);console.log(JSON.stringify({image:"cragentsdlcdev55eb.azurecr.io/"+s.name+"@"+s.digest,external:false,state:"Succeeded"}));' "$4"
    else echo ca-agentsdlc-dev-55eb-orders--abc123; fi ;;
  'rest --method post')
    node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("journey-request.json")).containers; if(c.length!==1 || c[0].image!=="pinned-image" || c[0].command[0]!=="node" || c[0].env.some(x=>x.secretRef)) process.exit(1); fs.appendFileSync("modes.log", c[0].env.find(x=>x.name==="JOURNEY_MODE").value+"\\n");'
    echo job-agentsdlc-dev-55eb-health-ab123 ;;
  'containerapp job execution') echo Succeeded ;;
  'containerapp replica list')
    if [[ -f was-running ]]; then echo '[]'; else touch was-running; echo '[{"properties":{"runningState":"Running"}}]'; fi ;;
  *) echo unexpected >&2; exit 1 ;;
esac
`);
    write('bin/sleep', '#!/usr/bin/env bash\nexit 0\n');
    let unix = tmp;
    if (process.platform === 'win32') {
      const result = spawnSync('bash', ['-c', 'cygpath -u "$1"', '_', tmp], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      unix = result.stdout.trim();
    }
    const release = require('../infra/private-release.json');
    const refs = Object.fromEntries(release.services.map(service => [service.refEnv, service.revision]));
    const env = { ...process.env, ...refs, TEST_ROOT: unix, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40) };
    const run = extra => spawnSync('bash', ['-c', 'cd "$TEST_ROOT"; export PATH="$TEST_ROOT/bin:$PATH"; bash scripts/journey-stage.sh'],
      { env: { ...env, ...extra }, encoding: 'utf8' });
    const refused = run({ GITHUB_RUN_ATTEMPT: '2' });
    assert.notEqual(refused.status, 0);
    assert.equal(fs.existsSync(path.join(tmp, 'modes.log')), false);
    const mismatch = run({ ORDERS_REF: 'b'.repeat(40) });
    assert.notEqual(mismatch.status, 0);
    assert.equal(fs.existsSync(path.join(tmp, 'modes.log')), false);
    const result = run({});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(tmp, 'modes.log'), 'utf8'), 'create\nverify\n');
    assert.match(fs.readFileSync(path.join(tmp, 'journey-audit.log'), 'utf8'), /orders scaled to zero/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
