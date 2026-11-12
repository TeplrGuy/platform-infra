const services = [
  ['portal', 'portal-web'],
  ['apigw', 'api-gateway'],
  ['orders', 'orders-service'],
  ['inventory', 'inventory-service'],
  ['notify', 'notifications-service']
];

async function journey(domain, orderId, mode, request = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!/^[a-z0-9-]+\.northeurope\.azurecontainerapps\.io$/.test(domain) ||
      !/^demo-[0-9]+$/.test(orderId) || !['create', 'verify'].includes(mode)) {
    throw Error('Invalid journey parameters.');
  }
  const url = name => `https://ca-agentsdlc-dev-7c77-${name}.internal.${domain}`;
  const get = async target => {
    const response = await request(target, { signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    return { status: response.status, body };
  };
  await Promise.all(services.map(async ([name, expected]) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await get(`${url(name)}/health`);
        if (result.status === 200 && result.body.service === expected && result.body.status === 'ok') return;
      } catch (error) {
        if (attempt === 3) throw Error(`Unable to warm ${expected}: ${error.name}`);
      }
      if (attempt < 3) await sleep(10000);
    }
    throw Error(`Unable to warm ${expected}.`);
  }));
  const orderUrl = `${url('portal')}/api/orders/${orderId}`;
  const assertOrder = result => {
    const order = result.body.order;
    if (result.status !== 200 || order?.orderId !== orderId || order.customerId !== 'demo-customer' ||
        order.sku !== 'SKU-100' || order.quantity !== 1 || order.status !== 'created' ||
        !order.timeline?.some(item => item.stage === 'inventory_reserved') ||
        !order.timeline?.some(item => item.stage === 'notification_accepted')) {
      throw Error('Order verification failed.');
    }
  };
  if (mode === 'create') {
    const existing = await get(orderUrl);
    if (existing.status !== 404 || existing.body.error !== 'order_not_found') {
      throw Error('Order ID already exists or could not be checked; refusing POST.');
    }
    const before = await get(`${url('inventory')}/inventory/SKU-100`);
    if (before.status !== 200 || before.body.sku !== 'SKU-100' ||
        !Number.isInteger(before.body.available) || before.body.available < 1) {
      throw Error('Inventory precondition failed; refusing POST.');
    }
    console.log(`JOURNEY POST_ATTEMPT order=${orderId} sku=SKU-100 quantity=1 before=${before.body.available}`);
    const response = await request(`${url('portal')}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': orderId },
      body: JSON.stringify({ orderId, customerId: 'demo-customer', sku: 'SKU-100', quantity: 1 }),
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.json();
    if (response.status !== 201) throw Error(`Order POST returned HTTP ${response.status}; do not retry without reconciliation.`);
    assertOrder({ status: 200, body });
    const after = await get(`${url('inventory')}/inventory/SKU-100`);
    if (after.status !== 200 || after.body.available !== before.body.available - 1) {
      throw Error('Inventory decrement could not be verified; do not retry.');
    }
    console.log(`JOURNEY INVENTORY PASS before=${before.body.available} after=${after.body.available}`);
  }
  assertOrder(await get(orderUrl));
  const notification = await get(`${url('notify')}/notifications/order/${orderId}`);
  if (notification.status !== 200 || notification.body.orderId !== orderId ||
      notification.body.count !== 1 || notification.body.items?.[0]?.orderId !== orderId) {
    throw Error('Notification verification failed.');
  }
  console.log(`JOURNEY_SUMMARY PASS mode=${mode} order=${orderId}`);
}

if (process.env.PRIVATE_JOURNEY_RUN === 'true') {
  journey(process.env.ACA_DOMAIN, process.env.ORDER_ID, process.env.JOURNEY_MODE).catch(error => {
    console.error(`JOURNEY_SUMMARY FAIL ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { journey };
