const assert = require('node:assert/strict');
const test = require('node:test');
const { journey } = require('../scripts/private-journey');

const domain = 'example-1234.northeurope.azurecontainerapps.io';
const id = 'demo-123';
const order = {
  orderId: id, customerId: 'demo-customer', sku: 'SKU-100', quantity: 1, status: 'created',
  timeline: [{ stage: 'inventory_reserved' }, { stage: 'notification_accepted' }]
};
const json = (status, body) => ({ status, json: async () => body });

function fixture(options = {}) {
  let created = options.existing || false;
  let posts = 0;
  const request = async (url, init) => {
    if (url.endsWith('/health')) {
      const match = [['portal', 'portal-web'], ['apigw', 'api-gateway'], ['orders', 'orders-service'],
        ['inventory', 'inventory-service'], ['notify', 'notifications-service']]
        .find(([name]) => url.includes(`-55eb-${name}.`));
      return json(200, { service: match[1], status: 'ok' });
    }
    if (init.method === 'POST') {
      posts++;
      if (options.postFailure) throw Error('timeout');
      created = true;
      return json(201, { order });
    }
    if (url.endsWith('/inventory/SKU-100')) return json(200, { sku: 'SKU-100', available: created ? 49 : 50 });
    if (url.endsWith(`/api/orders/${id}`)) return created ? json(200, { order }) : json(404, { error: 'order_not_found' });
    if (url.endsWith(`/notifications/order/${id}`)) return json(200, { orderId: id, count: options.badNotification ? 0 : 1, items: [{ orderId: id }] });
    throw Error(`Unexpected request ${url}`);
  };
  return { request, posts: () => posts };
}

test('one synthetic order verifies reservation, readback and notification', async () => {
  const f = fixture();
  await journey(domain, id, 'create', f.request, async () => {});
  assert.equal(f.posts(), 1);
});

test('verification is read-only and validates notification', async () => {
  const f = fixture({ existing: true, badNotification: true });
  await assert.rejects(() => journey(domain, id, 'verify', f.request, async () => {}), /Notification/);
  assert.equal(f.posts(), 0);
});

test('existing IDs and ambiguous POST failures never trigger a retry', async () => {
  const existing = fixture({ existing: true });
  await assert.rejects(() => journey(domain, id, 'create', existing.request, async () => {}), /refusing POST/);
  assert.equal(existing.posts(), 0);
  const failed = fixture({ postFailure: true });
  await assert.rejects(() => journey(domain, id, 'create', failed.request, async () => {}), /timeout/);
  assert.equal(failed.posts(), 1);
  await assert.rejects(() => journey('attacker.example', id, 'create', failed.request), /parameters/);
});
