const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

async function main() {
  const traces = [];
  const telemetry = [];
  let collectorError;
  let browserComplete = false;
  let child;
  let notified = false;
  let observedInventoryReads = 0;
  let observedTraces = [];
  let observedRoutes = [];
  function notifyWhenComplete() {
    if (!browserComplete || notified) return;
    const servicesByTrace = new Map();
    const routes = new Set();
    let inventoryReads = 0;
    for (const payload of traces) {
      for (const resource of payload.resourceSpans || []) {
        const service = resource.resource.attributes.find(item => item.key === 'service.name')?.value.stringValue;
        for (const scope of resource.scopeSpans || []) {
          for (const span of scope.spans || []) {
            const route = span.attributes?.find(item => item.key === 'http.route')?.value.stringValue;
            if (route) routes.add(route);
            if (service === 'inventory-service' && route === '/inventory/:sku') inventoryReads++;
            if (!servicesByTrace.has(span.traceId)) servicesByTrace.set(span.traceId, new Set());
            servicesByTrace.get(span.traceId).add(service);
          }
        }
      }
    }
    const expected = ['portal-web', 'api-gateway', 'orders-service', 'inventory-service', 'notifications-service'];
    observedInventoryReads = inventoryReads;
    observedTraces = [...servicesByTrace.values()].map(services => [...services]);
    observedRoutes = [...routes];
    if ([...servicesByTrace.values()].some(services => expected.every(service => services.has(service))) &&
        routes.has('/api/orders/:orderId') && inventoryReads >= 3) {
      notified = true;
      child.send('telemetry-complete');
    }
  }
  const collector = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        const payload = JSON.parse(body);
        telemetry.push(payload);
        if (request.url === '/v1/traces') traces.push(payload);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
        notifyWhenComplete();
      } catch (error) {
        collectorError = error;
        response.writeHead(400).end();
      }
    });
  });
  await new Promise((resolve, reject) => {
    collector.once('error', reject);
    collector.listen(0, '127.0.0.1', resolve);
  });

  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('OTEL_') || key === 'APPLICATIONINSIGHTS_CONNECTION_STRING') delete env[key];
    }
    env.FULL_STACK_LOCAL_OTLP_ENDPOINT = `http://127.0.0.1:${collector.address().port}`;
    child = spawn(process.execPath, [path.join(__dirname, 'full-stack-e2e.js')], {
      env, stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });
    child.on('message', message => {
      if (message === 'browser-complete') {
        browserComplete = true;
        notifyWhenComplete();
      }
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => signal ? reject(new Error(`Rehearsal terminated by ${signal}`)) : resolve(code));
    });
    assert.equal(exitCode, 0, `full-stack browser rehearsal failed; ${traces.length} trace exports, ${observedInventoryReads} inventory reads, traces ${JSON.stringify(observedTraces)}, routes ${JSON.stringify(observedRoutes)}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    if (collectorError) throw collectorError;
    const exposedKeys = new Set();
    for (const payload of traces) {
      for (const resource of payload.resourceSpans || []) {
        for (const scope of resource.scopeSpans || []) {
          for (const span of scope.spans || []) {
            const sentinels = ['ORD-PRIVATE-SENTINEL', 'SKU-PRIVATE-SENTINEL', 'QUERY-PRIVATE-SENTINEL'];
            if (sentinels.some(value => span.name.includes(value))) exposedKeys.add('span.name');
            for (const attribute of span.attributes || []) {
              if (sentinels.some(value => JSON.stringify(attribute.value).includes(value))) exposedKeys.add(attribute.key);
            }
          }
        }
      }
    }
    assert.equal(exposedKeys.size, 0,
      `Telemetry exposed a test identifier or query value in: ${[...exposedKeys].join(', ')}`);
    for (const sentinel of ['ORD-PRIVATE-SENTINEL', 'SKU-PRIVATE-SENTINEL', 'QUERY-PRIVATE-SENTINEL']) {
      assert.ok(!JSON.stringify(telemetry).includes(sentinel), 'Telemetry payload exposed a test identifier or query value');
    }

    const servicesByTrace = new Map();
    const routes = new Set();
    for (const payload of traces) {
      for (const resourceSpans of payload.resourceSpans || []) {
        const service = resourceSpans.resource.attributes.find(item => item.key === 'service.name')?.value.stringValue;
        for (const scope of resourceSpans.scopeSpans || []) {
          for (const span of scope.spans || []) {
            const route = span.attributes?.find(item => item.key === 'http.route')?.value.stringValue;
            if (route) routes.add(route);
            if (!servicesByTrace.has(span.traceId)) servicesByTrace.set(span.traceId, new Set());
            servicesByTrace.get(span.traceId).add(service);
          }
        }
      }
    }
    const expected = ['portal-web', 'api-gateway', 'orders-service', 'inventory-service', 'notifications-service'];
    assert.ok([...servicesByTrace.values()].some(services => expected.every(service => services.has(service))),
      `No single trace reached all services. Observed: ${JSON.stringify([...servicesByTrace.values()].map(services => [...services]))}`);
    assert.ok(routes.has('/api/orders/:orderId') && routes.has('/inventory/:sku'),
      `Missing sanitized route labels: ${[...routes].join(', ')}`);
    console.log('Verified a single distributed trace across all five services.');
  } finally {
    await new Promise(resolve => collector.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
