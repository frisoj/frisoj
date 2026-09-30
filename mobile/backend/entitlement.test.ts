import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasPro, makeCounter, reserveScan } from './api/_entitlement.ts';

test('free users get 3 scans, 4th is refused, release gives one back', async () => {
  const c = makeCounter({});
  const r = [await reserveScan('a', false, c), await reserveScan('a', false, c), await reserveScan('a', false, c)];
  assert.ok(r.every(Boolean));
  assert.equal(await reserveScan('a', false, c), null);
  await r[0]!();
  assert.ok(await reserveScan('a', false, c));
  assert.ok(await reserveScan('b', false, c));
});

test('pro is never limited', async () => {
  const c = makeCounter({});
  for (let i = 0; i < 10; i++) assert.ok(await reserveScan('p', true, c));
});

test('hasPro reads RevenueCat entitlement expiry', async () => {
  const f = (body: any, ok = true) => (async () => ({ ok, json: async () => body })) as any;
  const future = new Date(Date.now() + 1e6).toISOString();
  assert.equal(await hasPro('x', 's', f({ subscriber: { entitlements: { pro: { expires_date: future } } } })), true);
  assert.equal(await hasPro('x', 's', f({ subscriber: { entitlements: { pro: { expires_date: '2020-01-01T00:00:00Z' } } } })), false);
  assert.equal(await hasPro('x', 's', f({ subscriber: { entitlements: {} } })), false);
  assert.equal(await hasPro('x', undefined), false);
  assert.equal(await hasPro('x', 's', f({}, false)), false);
});
