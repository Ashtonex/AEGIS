const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('compliance commands cannot be queued offline, including legacy routes', () => {
  const sandbox = { self: { location: { origin: 'https://aegis.test' }, addEventListener() {} }, URL, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), sandbox);
  const request = (pathname, method = 'POST') => new Request(`https://aegis.test${pathname}`, {method});
  for (const pathname of ['/api/v1/compliance/foundation/obligations', '/api/v1/compliance/foundation/decisions/obligation-versions/123', '/api/v1/compliance-items/obligations', '/api/v1/workforce/people']) {
    assert.equal(sandbox.isQueueableRequest(request(pathname)), false, pathname);
  }
  assert.equal(sandbox.isQueueableRequest(request('/api/v1/site-notes')), true);
});
