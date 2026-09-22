/** Explicit local developer sample. Does not Apply a proposal or change a scene. */
import { MatrixClient, MatrixClientError } from '../src/integrations/matrix-client.ts';

const url = process.env.MATRIX_BASE_URL ?? 'http://127.0.0.1:8789';
try {
  const discovery = await MatrixClient.discover(url);
  console.log(JSON.stringify({ service: discovery.service, protocolVersion: discovery.protocolVersion,
    transport: discovery.transport, pairingAvailable: discovery.pairingAvailable, capabilities: discovery.capabilities }, null, 2));
  const pairingCode = process.env.MATRIX_PAIRING_CODE;
  if (pairingCode) {
    const client = await MatrixClient.pair(url, pairingCode);
    const scene = await client.scene();
    console.log(JSON.stringify({ paired: true, revision: scene.revision, runtimeSessionId: scene.runtimeSessionId }));
    const text = process.env.MATRIX_REQUEST_TEXT;
    if (text) {
      const requestId = process.env.MATRIX_REQUEST_ID;
      if (!requestId) throw new Error('Set a stable MATRIX_REQUEST_ID before proposing an action.');
      const result = await client.propose(text, { requestId, revision: scene.revision });
      console.log(JSON.stringify({ requestId: result.requestId, status: result.status, requiresApply: result.requiresApply }));
      console.log('Review and Apply in the local Matrix Operator. This companion has no Apply authority.');
    }
  } else {
    console.log('Discovery only. To pair, obtain a one-use code from the updated local Matrix client panel and set MATRIX_PAIRING_CODE.');
  }
} catch (error) {
  if (error instanceof MatrixClientError) {
    console.error(JSON.stringify({ code: error.code, message: error.message, outcomeUnknown: error.outcomeUnknown, requestId: error.requestId }));
  } else console.error(error instanceof Error ? error.message : 'Matrix sample failed.');
  process.exitCode = 1;
}
