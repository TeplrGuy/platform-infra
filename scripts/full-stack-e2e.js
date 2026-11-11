const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const children = [];
const serviceEnv = { ...process.env };
for (const key of Object.keys(serviceEnv)) {
  if (key.startsWith('OTEL_') || key === 'APPLICATIONINSIGHTS_CONNECTION_STRING') delete serviceEnv[key];
}
if (process.env.FULL_STACK_LOCAL_OTLP_ENDPOINT) {
  const endpoint = new URL(process.env.FULL_STACK_LOCAL_OTLP_ENDPOINT);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
    throw new Error('The rehearsal telemetry endpoint must be local HTTP on 127.0.0.1');
  }
  Object.assign(serviceEnv, {
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint.origin,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_TRACES_SAMPLER: 'always_on',
    OTEL_BSP_SCHEDULE_DELAY: '100',
    OTEL_METRIC_EXPORT_INTERVAL: '1000'
  });
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startService(name, entry, port, extraEnv) {
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(root, name),
    env: { ...serviceEnv, ...extraEnv, PORT: String(port), ENVIRONMENT_NAME: 'e2e' },
    stdio: 'inherit'
  });
  children.push(child);
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 600; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${name} exited before becoming healthy`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).service === name) return baseUrl;
    } catch (error) {
      if (error.name !== 'TypeError' && error.name !== 'TimeoutError') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${name} did not become healthy`);
}

async function main() {
  const ports = new Set();
  while (ports.size < 5) ports.add(await unusedPort());
  const [inventoryPort, notificationsPort, ordersPort, gatewayPort, portalPort] = ports;
  const inventory = await startService('inventory-service', 'src/index.js', inventoryPort, {});
  const notifications = await startService('notifications-service', 'src/index.js', notificationsPort, {});
  const orders = await startService('orders-service', 'src/index.js', ordersPort, {
    INVENTORY_SERVICE_URL: inventory, NOTIFICATIONS_SERVICE_URL: notifications
  });
  const gateway = await startService('api-gateway', 'src/index.js', gatewayPort, {
    ORDERS_SERVICE_URL: orders, INVENTORY_SERVICE_URL: inventory
  });
  const portal = await startService('portal-web', 'src/server.js', portalPort, { API_GATEWAY_URL: gateway });
  const playwright = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/full-stack-order.spec.ts'], {
    cwd: path.join(root, 'portal-web'),
    env: { ...serviceEnv, FULL_STACK_E2E: '1', PORTAL_BASE_URL: portal, INVENTORY_BASE_URL: inventory, NOTIFICATIONS_BASE_URL: notifications },
    stdio: 'inherit'
  });
  children.push(playwright);
  const exitCode = await new Promise((resolve, reject) => {
    playwright.once('error', reject);
    playwright.once('exit', (code, signal) => signal ? reject(new Error(`Playwright terminated by ${signal}`)) : resolve(code));
  });
  if (exitCode !== 0) throw new Error(`Playwright failed with exit code ${exitCode}`);
  if (process.env.FULL_STACK_LOCAL_OTLP_ENDPOINT && process.send) {
    await new Promise((resolve, reject) => {
      function onMessage(message) {
        clearTimeout(timeout);
        if (message === 'telemetry-complete') resolve();
        else reject(new Error('Unexpected telemetry collector response'));
      }
      const timeout = setTimeout(() => {
        process.removeListener('message', onMessage);
        process.disconnect();
        reject(new Error('Timed out waiting for telemetry export'));
      }, 15000);
      process.once('message', onMessage);
      process.send('browser-complete');
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});
