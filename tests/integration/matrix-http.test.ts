import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { MatrixClient, MatrixClientError } from '../../src/integrations/matrix-client.ts';

// Opt-in cross-repository acceptance. Starts only a new ephemeral loopback service,
// with synthetic room data. Never contacts the user's running Operator or headset.
test('real Matrix HTTP server: pairing, proposal, owner review, runtime receipt, cancellation, revoke', { skip: !process.env.MATRIX_CHECKOUT, timeout: 20000 }, async t => {
  const owner = randomBytes(24).toString('hex');
  const python = `import os,sys,tempfile,threading,json
sys.path.insert(0,os.path.join(os.environ['MATRIX_CHECKOUT'],'ControlService'))
from server import Server,State
with tempfile.TemporaryDirectory(prefix='school-matrix-test-') as folder:
 server=Server(('127.0.0.1',0),State(folder),os.environ['MATRIX_TEST_OWNER'])
 thread=threading.Thread(target=server.serve_forever,daemon=True)
 thread.start()
 print(json.dumps({'port':server.server_port}),flush=True)
 sys.stdin.buffer.read(1)
 server.shutdown()
 server.server_close()
 thread.join()
`;
  const child = spawn(process.env.PYTHON_EXE ?? 'python', ['-u', '-c', python], {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MATRIX_TEST_OWNER: owner },
  });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk.toString(); });
  const closed = once(child, 'close');
  t.after(async () => { child.stdin.end('x'); const timer = setTimeout(() => child.kill(), 3000); await closed; clearTimeout(timer); });
  const lines = createInterface({ input: child.stdout });
  const [line] = await Promise.race([once(lines, 'line'), closed.then(() => { throw new Error(`Matrix fixture could not start: ${errors.slice(0, 1000)}`); })]);
  lines.close();
  const url = `http://127.0.0.1:${JSON.parse(line).port}`;
  async function ownerRequest(path: string, body?: unknown): Promise<Record<string, any>> {
    const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  }
  const snapshot = { scene: { schemaVersion: 1, roomId: 'synthetic-room', objects: [] as Record<string, unknown>[] },
    assets: [{ assetId: 'cube', displayName: 'Cube' }], anchors: [{ anchorId: 'floor', displayName: 'Floor' }],
    selection: { anchorId: 'floor', objectId: '', position: { x: 1, y: 0, z: 2 } } };
  const exchange = (results: unknown[] = []) => ownerRequest('/api/exchange', { clientId: 'school-contract-fixture', snapshot, results });
  await exchange();
  const discovery = await MatrixClient.discover(url);
  assert.equal(discovery.service, 'matrix-loading-operator'); assert.equal(discovery.capabilities.capture, false);
  const code = await ownerRequest('/api/v1/pairings', { clientName: 'School contract fixture' });
  const client = await MatrixClient.pair(url, code.pairingCode);
  const scene = await client.scene();
  const proposed = await client.propose('Place a block here.', { requestId: 'contract-1', correlationId: 'opaque-turn-1', revision: scene.revision });
  assert.equal(proposed.status, 'ready'); assert.equal(proposed.requiresApply, true); assert.equal(proposed.observed, null);
  assert.equal((await exchange()).commands.length, 0);
  assert.equal((await client.propose('Place a block here.', { requestId: 'contract-1', correlationId: 'opaque-turn-1', revision: scene.revision })).proposal?.planId, proposed.proposal?.planId);
  const ownerPath = `/api/v1/operator/requests/${client.session.sessionId}/contract-1/apply`;
  const applied = await ownerRequest(ownerPath, {});
  const delivered = (await exchange()).commands;
  assert.equal(delivered.length, 1); assert.equal(delivered[0].op, 'spawn');
  assert.deepEqual(applied.commandIds, delivered.map((command: any) => command.requestId));
  assert.equal((await client.outcome('contract-1')).status, 'running');
  const command = delivered[0];
  snapshot.scene.objects.push({ objectId: 'fixture-cube', assetId: command.assetId, anchorId: command.anchorId, transform: command.transform });
  await exchange([{ requestId: command.requestId, ok: true, error: '', objectId: 'fixture-cube' }]);
  const completed = await client.outcome('contract-1');
  assert.equal(completed.status, 'succeeded'); assert.ok(completed.observed && 'snapshot' in completed.observed);
  assert.deepEqual(completed.observed.snapshot, snapshot);
  assert.deepEqual((await ownerRequest(ownerPath, {})).commandIds, applied.commandIds);
  assert.equal((await exchange()).commands.length, 0);
  const current = await client.scene();
  const cancelled = await client.propose('Place a block here.', { requestId: 'contract-2', revision: current.revision });
  assert.equal(cancelled.status, 'ready'); assert.equal((await client.cancel('contract-2')).status, 'cancelled');
  assert.equal((await exchange()).commands.length, 0);
  await ownerRequest(`/api/v1/operator/sessions/${client.session.sessionId}/revoke`, {});
  await assert.rejects(client.scene(), (error: unknown) => error instanceof MatrixClientError && error.status === 401);
});
