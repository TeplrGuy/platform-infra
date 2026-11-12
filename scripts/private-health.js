const names = [
  ['portal-web', 'ca-agentsdlc-dev-7c77-portal'],
  ['api-gateway', 'ca-agentsdlc-dev-7c77-apigw'],
  ['orders-service', 'ca-agentsdlc-dev-7c77-orders'],
  ['inventory-service', 'ca-agentsdlc-dev-7c77-inventory'],
  ['notifications-service', 'ca-agentsdlc-dev-7c77-notify']
];

async function check(domain, request = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!/^[a-z0-9-]+\.northeurope\.azurecontainerapps\.io$/.test(domain)) {
    throw Error('Unexpected Container Apps environment domain.');
  }
  const targets = names.map(([service, app]) => [service, service, `https://${app}.internal.${domain}/health`]);
  targets.push(['portal-to-gateway', 'api-gateway', `https://${names[0][1]}.internal.${domain}/api/health`]);
  let success = true;
  for (const [label, expected, url] of targets) {
    let ok = false;
    let detail = 'no response';
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      try {
        const response = await request(url, { signal: AbortSignal.timeout(20000) });
        const body = await response.json();
        ok = response.ok && body.status === 'ok' && body.service === expected;
        detail = `HTTP ${response.status}`;
      } catch (error) {
        detail = error.name;
      }
      if (!ok && attempt < 3) await sleep(10000);
    }
    console.log(`HEALTH ${label} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
    success = success && ok;
  }
  return success;
}

if (process.env.PRIVATE_HEALTH_RUN === 'true') {
  check(process.env.ACA_DOMAIN).then(ok => {
    console.log(`HEALTH_SUMMARY ${ok ? 'PASS' : 'FAIL'}`);
    process.exitCode = ok ? 0 : 1;
  }).catch(error => {
    console.error(`HEALTH_SUMMARY FAIL ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { check };
