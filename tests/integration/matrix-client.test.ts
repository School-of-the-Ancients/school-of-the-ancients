import test from 'node:test';
import assert from 'node:assert/strict';
import { MatrixClient, MatrixClientError } from '../../src/integrations/matrix-client.ts';

const token = 'fixture-token-not-a-real-credential';
const binding = { protocolVersion: '1', sessionId: 'client-fixture', runtimeSessionId: 'runtime-fixture' };
function response(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function outcome(overrides: Record<string, unknown> = {}) {
  return { ...binding, requestId: 'req-1', correlationId: 'turn-1', sequence: 1, status: 'ready', requiresApply: true,
    proposal: { planId: 'plan-fixture' }, commandIds: [], receipts: [], observed: null, error: null, ...overrides };
}
function fixture(handler?: (url: URL, init: RequestInit, calls: Array<{ path: string; init: RequestInit }>) => Response | Promise<Response>) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); calls.push({ path: url.pathname, init });
    if (url.pathname === '/api/v1/sessions') {
      assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(String(init.body)), { pairingCode: 'pair-fixture' });
      return response({ ...binding, clientToken: token, expiresInSeconds: 3600 });
    }
    if (url.pathname === '/api/v1/discovery') return response({ protocolVersion: '1', service: 'matrix-loading-operator', transport: 'local-companion', pairingAvailable: true, capabilities: { capture: false } });
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
    return handler?.(url, init, calls) ?? response({ ...binding, revision: 4, snapshot: { objects: [] }, runtime: { online: true } });
  };
  return { calls, options: { fetch: fetcher }, pair: () => MatrixClient.pair('http://127.0.0.1:8789', 'pair-fixture', { fetch: fetcher }) };
}

test('discovery is unpaired and credentials never appear in public session metadata', async () => {
  const f = fixture();
  const discovery = await MatrixClient.discover('http://127.0.0.1:8789', f.options);
  assert.equal(discovery.capabilities.capture, false);
  assert.equal(new Headers(f.calls[0].init.headers).has('Authorization'), false);
  const client = await f.pair();
  assert.deepEqual(client.session, { sessionId: binding.sessionId, runtimeSessionId: binding.runtimeSessionId });
  assert.equal(JSON.stringify(client).includes(token), false);
  assert.equal((await client.scene()).revision, 4);
});

test('proposal remains reviewed; only a later receipt contains an observed result', async () => {
  let applied = false;
  const f = fixture((url, init) => {
    if (url.pathname === '/api/v1/requests') {
      assert.deepEqual(JSON.parse(String(init.body)), { requestId: 'req-1', correlationId: 'turn-1', expected: { runtimeSessionId: binding.runtimeSessionId, revision: 4 }, intent: { text: 'Make it twice as big', mode: 'offline-rules' } });
      return response(outcome());
    }
    return response(applied ? outcome({ sequence: 3, status: 'succeeded', requiresApply: false, commandIds: ['command-1'], receipts: [{ requestId: 'command-1', ok: true, error: '', objectId: 'block-1' }], observed: { revision: 5, snapshot: { objects: [{ id: 'block-1', scale: [2,2,2] }] } } }) : outcome());
  });
  const client = await f.pair();
  const proposed = await client.propose('Make it twice as big', { requestId: 'req-1', correlationId: 'turn-1', revision: 4 });
  assert.equal(proposed.status, 'ready'); assert.equal(proposed.observed, null); assert.equal(proposed.requiresApply, true);
  assert.equal(typeof (client as unknown as Record<string, unknown>).apply, 'undefined');
  applied = true;
  const result = await client.outcome('req-1');
  assert.equal(result.status, 'succeeded'); assert.equal(result.observed?.revision, 5);
});

test('an ambiguous mutation is not retried and can be reconciled with the same request ID', async () => {
  let submitted = 0;
  const f = fixture((url) => {
    if (url.pathname === '/api/v1/requests') { submitted++; throw new Error('connection closed after dispatch'); }
    return response(outcome({ status: 'ready' }));
  });
  const client = await f.pair();
  await assert.rejects(client.propose('Summon a block', { requestId: 'req-1', revision: 4 }), (e: unknown) => {
    assert.ok(e instanceof MatrixClientError); assert.equal(e.outcomeUnknown, true); assert.equal(e.requestId, 'req-1'); return true;
  });
  assert.equal(submitted, 1);
  assert.equal((await client.outcome('req-1')).status, 'ready');
  assert.equal(submitted, 1);
});

test('client refuses a response from a replacement runtime and older outcome sequences', async () => {
  let current = outcome({ sequence: 4 });
  const f = fixture(() => response(current)); const client = await f.pair();
  await client.outcome('req-1');
  current = outcome({ sequence: 2 });
  await assert.rejects(client.outcome('req-1'), (e: unknown) => e instanceof MatrixClientError && e.code === 'out_of_order');
  current = outcome({ sequence: 5, runtimeSessionId: 'another-runtime' });
  await assert.rejects(client.outcome('req-1'), /another pairing or runtime/);
});

test('cancel remains an explicit server outcome, not a promise of rollback', async () => {
  const f = fixture((url, init) => {
    assert.equal(url.pathname, '/api/v1/requests/req-1/cancel'); assert.equal(init.method, 'POST');
    return response(outcome({ sequence: 3, status: 'unconfirmed', requiresApply: false, error: 'Dispatched request must be reconciled.' }));
  });
  const client = await f.pair();
  assert.equal((await client.cancel('req-1')).status, 'unconfirmed');
});

test('pre-dispatch cancellation is known and performs no network request', async () => {
  const f = fixture(); const client = await f.pair(); const count = f.calls.length;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.propose('Summon a block', { requestId: 'req-1', revision: 4, signal: controller.signal }), (e: unknown) => e instanceof MatrixClientError && e.code === 'cancelled' && !e.outcomeUnknown);
  assert.equal(f.calls.length, count);
});

test('remote origins, embedded credentials, and request path injection are rejected before networking', async () => {
  const f = fixture();
  for (const url of ['https://example.com','http://127.0.0.1@evil.example','http://user:secret@localhost','http://localhost/path','http://localhost?token=secret']) {
    await assert.rejects(MatrixClient.discover(url, f.options), (e: unknown) => e instanceof MatrixClientError && e.code === 'invalid_url');
  }
  assert.equal(f.calls.length, 0);
  const client = await f.pair();
  await assert.rejects(client.outcome('../apply'), /bounded stable identifier/);
  assert.equal(f.calls.length, 1);
});

test('malformed/oversized responses and unsupported protocol versions fail explicitly', async () => {
  await assert.rejects(MatrixClient.discover('http://localhost', { fetch: async () => response({ protocolVersion: '2' }) }), /unsupported protocol/);
  await assert.rejects(MatrixClient.discover('http://localhost', { fetch: async () => new Response('x'.repeat(200)), maxResponseBytes: 64 }), (e: unknown) => e instanceof MatrixClientError && e.code === 'response_too_large');
  await assert.rejects(MatrixClient.discover('http://localhost', { fetch: async () => new Response('<html>error</html>') }), /malformed JSON/);
});

test('server rejection text cannot leak bearer credentials or private room data', async () => {
  const f = fixture(() => response({ code: 'expired_session', error: `secret ${token} private room snapshot` }, 401));
  const client = await f.pair();
  await assert.rejects(client.scene(), (e: unknown) => {
    assert.ok(e instanceof MatrixClientError); assert.equal(e.status, 401); assert.equal(e.code, 'expired_session');
    assert.equal(e.message.includes(token), false); assert.equal(e.message.includes('private room'), false); return true;
  });
});

test('invalid or contradictory post-dispatch results remain uncertain and are never retried', async () => {
  for (const malformed of [outcome({ runtimeSessionId: 'wrong-runtime' }), outcome({ status: 'succeeded', requiresApply: false }), outcome({ status: 'ready', requiresApply: false })]) {
    let submitted = 0;
    const f = fixture(() => { submitted++; return response(malformed); }); const client = await f.pair();
    await assert.rejects(client.propose('Place a block here.', { requestId: 'req-1', revision: 4 }), (error: unknown) => error instanceof MatrixClientError && error.outcomeUnknown && error.requestId === 'req-1');
    assert.equal(submitted, 1);
  }
  const f = fixture(() => response({ code: 'internal_error' }, 500)); const client = await f.pair();
  await assert.rejects(client.cancel('req-1'), (error: unknown) => error instanceof MatrixClientError && error.outcomeUnknown);
});

test('synchronous PC save has saved-scene evidence rather than invented runtime receipts', async () => {
  const f = fixture(() => response(outcome({ status: 'succeeded', requiresApply: false, observed: { revision: 4, savedScene: 'fixture-room' } })));
  const client = await f.pair(); const saved = await client.outcome('req-1');
  assert.deepEqual(saved.observed, { revision: 4, savedScene: 'fixture-room' }); assert.equal(saved.receipts.length, 0);
});
