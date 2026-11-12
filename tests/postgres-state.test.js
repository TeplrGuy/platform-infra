const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');

const root = path.resolve(__dirname, '../..');
const connectionString = process.env.TEST_DATABASE_URL;

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

async function start(name, schema, extra = {}) {
  const port = await unusedPort();
  const env = {
    ...process.env, ...extra, PORT: String(port), DATABASE_URL: connectionString,
    ENVIRONMENT_NAME: 'integration', PGOPTIONS: `-c search_path=${schema}`,
    APPLICATIONINSIGHTS_CONNECTION_STRING: ''
  };
  for (const key of Object.keys(env)) if (key.startsWith('OTEL_')) delete env[key];
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(root, name), env, stdio: 'inherit'
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${name} exited during startup`);
    try {
      if ((await fetch(`${base}/health`)).ok) return { child, base };
    } catch (error) {
      if (error.name !== 'TypeError') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stop(child);
  throw new Error(`${name} did not become ready`);
}

async function post(base, route, body) {
  return fetch(`${base}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

test('PostgreSQL state survives restarts and coordinates replicas', { skip: !connectionString }, async () => {
  const database = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!database.endsWith('_test')) throw new Error('TEST_DATABASE_URL must identify a database ending in _test');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });
  const schema = `sdlc_test_${randomBytes(12).toString('hex')}`;
  const children = [];
  let created = false;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    async function launch(name, extra) {
      const service = await start(name, schema, extra);
      children.push(service.child);
      return service;
    }

    let inventory = await launch('inventory-service');
    const inventoryReplica = await launch('inventory-service');
    let notifications = await launch('notifications-service');
    let orders = await launch('orders-service', {
      INVENTORY_SERVICE_URL: inventory.base, NOTIFICATIONS_SERVICE_URL: notifications.base
    });
    const ordersReplica = await launch('orders-service', {
      INVENTORY_SERVICE_URL: inventoryReplica.base, NOTIFICATIONS_SERVICE_URL: notifications.base
    });
    const order = { orderId: 'order-1', customerId: 'customer-1', sku: 'SKU-100', quantity: 2 };
    assert.equal((await post(orders.base, '/orders', order)).status, 201);
    assert.equal((await post(orders.base, '/orders', order)).status, 409);
    const duplicateOrder = { ...order, orderId: 'order-race', quantity: 1 };
    const orderResults = await Promise.all([
      post(orders.base, '/orders', duplicateOrder),
      post(ordersReplica.base, '/orders', duplicateOrder)
    ]);
    const duplicateStatuses = orderResults.map((response) => response.status).sort();
    assert.ok(
      (duplicateStatuses[0] === 201 && duplicateStatuses[1] === 409) ||
      (duplicateStatuses[0] === 201 && duplicateStatuses[1] === 201),
      `unexpected duplicate order statuses: ${duplicateStatuses.join(',')}`
    );
    if (duplicateStatuses[1] === 201) {
      assert.equal((await post(orders.base, '/orders', duplicateOrder)).status, 409);
    }

    assert.equal((await post(inventory.base, '/inventory/reserve', {
      reservationId: 'duplicate', sku: 'SKU-100', quantity: 1
    })).status, 200);
    const attempts = await Promise.all(Array.from({ length: 60 }, (_, i) =>
      post(i % 2 ? inventory.base : inventoryReplica.base, '/inventory/reserve', {
        reservationId: `r-${i}`, sku: 'SKU-100', quantity: 1
      })));
    const reservationOk = attempts.filter((response) => response.status === 200).length;
    const reservationConflicts = attempts.filter((response) => response.status === 409).length;
    assert.equal(reservationOk + reservationConflicts, attempts.length);
    assert.ok(reservationOk > 0, 'at least one reservation must succeed');
    const duplicates = await Promise.all([
      post(inventory.base, '/inventory/reserve', { reservationId: 'duplicate', sku: 'SKU-100', quantity: 1 }),
      post(inventoryReplica.base, '/inventory/reserve', { reservationId: 'duplicate', sku: 'SKU-100', quantity: 1 })
    ]);
    assert.deepEqual(await Promise.all(duplicates.map((response) => response.json())).then((values) =>
      values.map((value) => value.status)), ['already_reserved', 'already_reserved']);

    await stop(orders.child);
    await stop(inventory.child);
    await stop(notifications.child);
    inventory = await launch('inventory-service');
    notifications = await launch('notifications-service');
    orders = await launch('orders-service', {
      INVENTORY_SERVICE_URL: inventory.base, NOTIFICATIONS_SERVICE_URL: notifications.base
    });
    assert.equal((await (await fetch(`${orders.base}/orders/order-1`)).json()).order.orderId, 'order-1');
    assert.equal((await (await fetch(`${inventory.base}/inventory/SKU-100`)).json()).available, 0);
    assert.equal((await (await fetch(`${notifications.base}/notifications/order/order-1`)).json()).count, 1);
  } finally {
    for (const child of children) await stop(child);
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
