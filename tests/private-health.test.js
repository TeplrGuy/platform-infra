const assert = require('node:assert/strict');
const test = require('node:test');
const { check } = require('../scripts/private-health');

const domain = 'example-1234.northeurope.azurecontainerapps.io';
const service = url => {
  if (url.endsWith('/api/health')) return 'api-gateway';
  return url.includes('-portal.') ? 'portal-web'
    : url.includes('-apigw.') ? 'api-gateway'
      : url.includes('-orders.') ? 'orders-service'
        : url.includes('-inventory.') ? 'inventory-service' : 'notifications-service';
};

test('private health checks validate each service and the portal-to-gateway path', async () => {
  const urls = [];
  const request = async url => {
    urls.push(url);
    if (url.includes('-portal.')) {
      return {
        ok: false,
        status: 401,
        headers: { get: () => 'Bearer authorization_uri=\"https://login.microsoftonline.com/16b3c013-d300-468d-ac64-7eda0820b6d3/oauth2/v2.0/authorize\"' }
      };
    }
    return { ok: true, status: 200, json: async () => ({ status: 'ok', service: service(url) }) };
  };
  assert.equal(await check(domain, request, async () => {}), true);
  assert.equal(urls.length, 6);
  assert.ok(urls.every(url => url.includes(`.internal.${domain}/`)));
  assert.ok(urls.some(url => url.endsWith('/api/health')));
});

test('private health checks fail closed on invalid domains and incorrect responses', async () => {
  await assert.rejects(() => check('attacker.example', async () => {}), /domain/);
  let requests = 0;
  const wrongService = async () => {
    requests++;
    return { ok: true, status: 200, json: async () => ({ status: 'ok', service: 'wrong' }) };
  };
  assert.equal(await check(domain, wrongService, async () => {}), false);
  assert.equal(requests, 24);
});
