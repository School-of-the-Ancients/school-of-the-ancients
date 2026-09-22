import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { FileSchoolRepository } from '../../src/server/repository.ts';
import { SchoolService } from '../../src/server/school-service.ts';
import { DemoMentorProvider } from '../../src/server/providers.ts';
import { createSchoolServer } from '../../src/server/http.ts';

// Opt-in acceptance against the actual Python service. All records, credentials,
// ports and runtime observations belong to this synthetic fixture.
for (const mode of ['virtual', 'ar'] as const) test(`School HTTP → Matrix HTTP → ${mode} runtime placement; durable restart without replay`, { skip: !process.env.MATRIX_CHECKOUT, timeout: 25000 }, async t => {
  const owner = randomBytes(24).toString('hex');
  const python = `import os,sys,tempfile,threading,json
sys.path.insert(0,os.path.join(os.environ['MATRIX_CHECKOUT'],'ControlService'))
from server import Server,State
with tempfile.TemporaryDirectory(prefix='school-bridge-test-') as folder:
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
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MATRIX_TEST_OWNER: owner },
  });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk.toString(); });
  const closed = once(child, 'close');
  t.after(async () => { child.stdin.end('x'); const timer = setTimeout(() => child.kill(), 3000); await closed; clearTimeout(timer); });
  const lines = createInterface({ input: child.stdout });
  const [line] = await Promise.race([once(lines, 'line'), closed.then(() => { throw new Error(`Matrix fixture startup failed: ${errors.slice(0, 1000)}`); })]);
  lines.close();
  const matrixUrl = `http://127.0.0.1:${JSON.parse(line).port}`;
  async function matrix(path: string, body?: unknown): Promise<Record<string, any>> {
    const response = await fetch(matrixUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  }
  const snapshot: Record<string, any> = { scene: { schemaVersion: 1, roomId: 'synthetic-bridge-room', objects: [] as Record<string, unknown>[] },
    assets: [{ assetId: 'block', displayName: 'Block' }], anchors: [{ anchorId: 'floor', displayName: 'Floor' }],
    selection: { anchorId: 'floor', objectId: '', position: { x: 1, y: 0, z: 2 } } };
  if (mode === 'ar') {
    snapshot.roomContext = { mode: 'ar', state: 'ready', alignmentVerified: true, message: '' };
    snapshot.assets = [{ assetId: 'block', displayName: 'Block', spawnScale: .2, localBounds: { center: { x: 0, y: .2, z: 0 }, size: { x: 1, y: 2, z: 1 } } }];
    snapshot.anchors = [{ anchorId: 'floor', displayName: 'Synthetic floor', source: 'mruk', semanticLabels: ['FLOOR'], surface: { kind: 'support', boundary: [
      { x: -3, y: 0, z: -3 }, { x: 3, y: 0, z: -3 }, { x: 3, y: 0, z: 3 }, { x: -3, y: 0, z: 3 },
    ] } }];
  }
  const exchange = (results: unknown[] = []) => matrix('/api/exchange', { clientId: 'school-bridge-fixture', snapshot, results });
  await exchange();

  const directory = mkdtempSync(join(tmpdir(), 'school-http-bridge-'));
  let service = new SchoolService(new FileSchoolRepository(directory), new DemoMentorProvider(0));
  let server = createSchoolServer({ service }); let schoolUrl = '';
  async function listen() { server.listen(0, '127.0.0.1'); await once(server, 'listening'); schoolUrl = `http://127.0.0.1:${(server.address() as {port:number}).port}`; }
  async function stop() { service.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  t.after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });
  await listen();
  async function school(path: string, body?: unknown, expected = 200): Promise<Record<string, any>> {
    const response = await fetch(schoolUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  }
  const started = await school('/api/v1/sessions', { requestId: randomUUID(), mentorId: 'galileo', lessonId: 'observation-and-scale' }, 201);
  const path = `/api/v1/sessions/${started.session.id}`;
  const unpaired = await school(path + '/matrix'); assert.equal(unpaired.bridge.connected, false);
  const code = await matrix('/api/v1/pairings', { clientName: 'School HTTP bridge acceptance' });
  const paired = await school(path + '/matrix/pair', { requestId: randomUUID(), expectedRevision: started.session.revision, url: matrixUrl, pairingCode: code.pairingCode });
  assert.equal(paired.bridge.readiness.canLaunch, true); assert.equal(paired.bridge.operatorUrl, matrixUrl + '/clients');
  const request = { requestId: randomUUID(), expectedRevision: paired.session.revision, bindingId: paired.bridge.binding.id, expectedMatrixRevision: paired.bridge.readiness.matrixRequest.revision };
  const proposal = await school(path + '/matrix/demonstrations', request);
  assert.equal(proposal.demonstration.status, 'ready'); assert.equal(proposal.demonstration.requiresApply, true);
  assert.equal(proposal.session.stage, 'explain'); assert.equal((await exchange()).commands.length, 0);
  assert.deepEqual(await school(path + '/matrix/demonstrations', request), proposal);
  await school(path + '/matrix/demonstrations/' + request.requestId + '/apply', {}, 404);
  const ownerPath = `/api/v1/operator/requests/${paired.bridge.binding.matrixSessionId}/${request.requestId}/apply`;
  await matrix(ownerPath, {});
  const commands = (await exchange()).commands; assert.equal(commands.length, 1); assert.equal(commands[0].assetId, 'block');
  assert.equal((await school(path + '/matrix/demonstrations/' + request.requestId)).demonstration.status, 'running');
  const command = commands[0];
  const observedTransform = structuredClone(command.transform);
  if (mode === 'ar') {
    assert.equal(command.placement, 'surface');
    const bounds = snapshot.assets[0].localBounds;
    observedTransform.position.y -= (bounds.center.y - bounds.size.y / 2) * observedTransform.scale.y;
  } else assert.equal(command.placement, undefined);
  snapshot.scene.objects.push({ objectId: 'synthetic-observed-block', assetId: command.assetId, anchorId: command.anchorId, transform: observedTransform });
  await exchange([{ requestId: command.requestId, ok: true, error: '', objectId: 'synthetic-observed-block' }]);
  const observed = await school(path + '/matrix/demonstrations/' + request.requestId);
  assert.equal(observed.demonstration.status, 'succeeded'); assert.equal(observed.demonstration.observed.objects.length, 1);
  assert.equal(observed.demonstration.observed.objects[0].objectId, 'synthetic-observed-block');
  assert.deepEqual(observed.demonstration.observed.objects[0].position, observedTransform.position);
  assert.equal(observed.session.stage, started.session.stage); assert.deepEqual(observed.session.artifact, started.session.artifact);
  assert.match(observed.session.messages.at(-1).text, /does not establish camera evidence/);
  assert.equal((await exchange()).commands.length, 0);
  const ready = await school(path + '/matrix');
  const pendingId = randomUUID();
  const pending = await school(path + '/matrix/demonstrations', { requestId: pendingId, expectedRevision: ready.session.revision, bindingId: ready.bridge.binding.id, expectedMatrixRevision: ready.bridge.readiness.matrixRequest.revision });
  assert.equal(pending.demonstration.status, 'ready');
  const disk = readFileSync(join(directory, 'school-store.json'), 'utf8');
  assert.equal(disk.includes(code.pairingCode), false); assert.equal(disk.includes(owner), false); assert.equal(disk.includes('synthetic-bridge-room'), false);

  await stop(); service = new SchoolService(new FileSchoolRepository(directory), new DemoMentorProvider(0)); server = createSchoolServer({ service }); await listen();
  const restored = await school(path + '/matrix'); assert.equal(restored.bridge.connected, false);
  const oldSuccess = restored.bridge.demonstrations.find((d: any) => d.id === request.requestId);
  assert.deepEqual(oldSuccess.observed, observed.demonstration.observed); assert.equal(oldSuccess.status, 'succeeded');
  assert.equal(restored.bridge.demonstrations.find((d: any) => d.id === pendingId).status, 'unconfirmed');
  const unresolved = await school(path + '/matrix/demonstrations/' + pendingId); assert.equal(unresolved.demonstration.status, 'unconfirmed');
  assert.match(unresolved.demonstration.checkError, /original pairing/); assert.equal((await exchange()).commands.length, 0);
  const independent = await school(path + '/experiment', { requestId: randomUUID(), expectedRevision: unresolved.session.revision, dimensions: [2, 2, 2] });
  assert.equal(independent.session.artifact.volume, 8); assert.equal(independent.session.stage, 'explain');
});
