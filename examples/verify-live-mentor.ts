/** Explicit opt-in smoke check; uses a real Codex turn and existing local sign-in. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileSchoolRepository } from '../src/server/repository.ts';
import { SchoolService } from '../src/server/school-service.ts';
import { CodexMentorProvider } from '../src/server/providers.ts';
import { GALILEO, OBSERVATION_LESSON } from '../src/server/content.ts';

if (!process.env.SCHOOL_CODEX_EXE || !process.env.SCHOOL_CODEX_MODEL) {
  throw new Error('Set SCHOOL_CODEX_EXE and SCHOOL_CODEX_MODEL explicitly. This check calls a real model.');
}
const directory = mkdtempSync(join(tmpdir(), 'school-live-check-'));
const service = new SchoolService(new FileSchoolRepository(directory), new CodexMentorProvider());
try {
  const { session } = service.start({ requestId: randomUUID(), mentorId: GALILEO.id, lessonId: OBSERVATION_LESSON.id });
  const { turn } = service.createTurn(session.id, { requestId: randomUUID(), expectedRevision: session.revision, kind: 'question', text: 'If I double only the width of a rectangular block and keep height and depth unchanged, what happens to its volume? Explain before asking me a question.' });
  const deadline = Date.now() + 145000;
  while (service.turn(turn.id).turn.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
  const result = service.turn(turn.id);
  if (result.turn.status !== 'completed') throw new Error(result.turn.error ?? 'The live mentor check did not complete.');
  console.log(JSON.stringify({ status: result.turn.status, stageUnchanged: result.session.stage === session.stage,
    receipt: result.turn.receipt, response: result.turn.output, provider: service.provider.status() }, null, 2));
} finally {
  service.close();
  if (resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes('school-live-check-')) rmSync(directory, { recursive: true, force: true });
}
