"""Explicit opt-in live mentor -> Matrix planner -> isolated Windows acceptance.

Use --self-test for the pure proposal allowlist. --run-live invokes three real
Codex turns and an owned Windows validation player; never use a normal build.
All services use new loopback ports. No existing application is reconfigured.
The harness applies only exactly two small built-in block spawns after inspecting
the complete proposal. This is an automated owner action, not human review.
"""
import argparse
import copy
import importlib.util
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import uuid

BASE_PATH = Path(__file__).with_name('verify-matrix-scale-windows.py')
SPEC = importlib.util.spec_from_file_location('school_windows_acceptance', BASE_PATH)
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

QUESTION = ('Please suggest a Matrix demonstration using exactly two small built-in blocks, '
            'one cube and one twice as wide with matching height and depth, on the currently selected floor. '
            'Use scales around 0.2 for the cube and 0.4 by 0.2 by 0.2 for the wider block. '
            'Keep them separate, close to the selected point and preserve every existing object. '
            'Explain the volume comparison as virtual geometry, not a physical measurement. '
            'Provide the suggestion only; I will explicitly send it to Matrix for Operator review.')
REFLECTION = ('Use only the recorded Matrix result to explain what has been acknowledged. '
              'Distinguish the successful runtime commands from proof that the two blocks illustrate '
              'the intended comparison, physical measurements, or evidence that I mastered the lesson. '
              'Explain the mathematical prediction if one block is twice as wide with equal height and depth. '
              'Do not suggest or request another scene change.')


def allowed_commands(commands, snapshot):
    """This harness cannot Apply arbitrary model output, even when Matrix allows it."""
    if not isinstance(commands, list) or len(commands) != 2:
        return False
    selected = snapshot.get('selection', {})
    anchor = selected.get('anchorId')
    point = selected.get('position')
    if not isinstance(anchor, str) or not anchor or not isinstance(point, dict):
        return False
    scales = []
    positions = []
    for command in commands:
        if (not isinstance(command, dict) or set(command) != {'op', 'assetId', 'anchorId', 'transform'}
                or command['op'] != 'spawn' or command['assetId'] != 'block' or command['anchorId'] != anchor):
            return False
        transform = command['transform']
        if not isinstance(transform, dict) or set(transform) != {'position', 'rotation', 'scale'}:
            return False
        for part in transform.values():
            if not isinstance(part, dict) or set(part) != {'x', 'y', 'z'} or any(type(v) not in (int, float) or not math.isfinite(v) for v in part.values()):
                return False
        if any(abs(v) > 1e-5 for v in transform['rotation'].values()):
            return False
        if any(not .05 <= v <= .5 for v in transform['scale'].values()):
            return False
        if any(abs(transform['position'][axis] - point[axis]) > 1 for axis in ('x', 'y', 'z')):
            return False
        scales.append(transform['scale'])
        positions.append(transform['position'])
    first, second = sorted(scales, key=lambda scale: scale['x'])
    close = lambda a, b: math.isclose(a, b, rel_tol=1e-5, abs_tol=1e-5)
    if not (close(first['x'], first['y']) and close(first['x'], first['z'])
            and close(second['x'], 2 * first['x']) and close(second['y'], first['y']) and close(second['z'], first['z'])):
        return False
    # Axis-aligned bounds must be separate, so a duplicate/overlapping pair is rejected.
    return any(abs(positions[0][axis] - positions[1][axis]) > (scales[0][axis] + scales[1][axis]) / 2 + .01 for axis in ('x', 'z'))


def self_test():
    point = {'x': 0, 'y': 0, 'z': 0}
    snapshot = {'selection': {'anchorId': 'fixture-floor', 'position': point}}
    commands = [{'op': 'spawn', 'assetId': 'block', 'anchorId': 'fixture-floor', 'transform': {
        'position': {'x': x, 'y': .1, 'z': 0}, 'rotation': dict(point), 'scale': {'x': width, 'y': .2, 'z': .2}}}
        for x, width in ((-.25, .2), (.25, .4))]
    assert allowed_commands(commands, snapshot)
    changes = [lambda value: value.append({'op': 'clear'}),
               lambda value: value[0].update(op='delete'),
               lambda value: value[0].update(assetId='downloaded'),
               lambda value: value[0].update(anchorId='other-room'),
               lambda value: value[0]['transform']['scale'].update(x=4),
               lambda value: value[0]['transform']['position'].update(x=5),
               lambda value: value[0]['transform']['position'].update(x=.25),
               lambda value: value[0]['transform']['scale'].update(z=float('nan')),
               lambda value: value[1]['transform']['scale'].update(x=.3),
               lambda value: value[0].update(placement='surface')]
    for change in changes:
        altered = copy.deepcopy(commands)
        change(altered)
        assert not allowed_commands(altered, snapshot)
    print('Proposal allowlist: 11 checks passed; no provider or runtime was started.')


class MentorAcceptance(BASE.Acceptance):
    def __init__(self, args):
        super().__init__(args)
        self.codex = args.codex_exe.resolve(strict=True)
        with self.codex.open('rb') as executable:
            native_header = executable.read(2)
        self.check(self.codex.suffix.lower() == '.exe' and native_header == b'MZ', 'Live provider uses an explicitly selected native executable')
        self.report.update(mentorProvider='live Codex CLI via ChatGPT login', requestedModel='gpt-5.6-sol',
                           runnerSha256=BASE.sha(Path(__file__), True), reusedRunnerSha256=BASE.sha(BASE_PATH, True),
                           codexExecutableSha256=BASE.sha(self.codex), mentorTurns=[],
                           ownerApply='Automated authenticated owner endpoint after exact two-block allowlist validation',
                           reflectionSemanticReview='pending separate inspection of authored QA output')
        self.old_environment = {name: os.environ.get(name) for name in
            ('SANDBOX_AI_MODE', 'SANDBOX_CODEX_EXE', 'SANDBOX_CODEX_MODEL', 'SANDBOX_CODEX_REASONING',
             'SCHOOL_CODEX_EXE', 'SCHOOL_CODEX_MODEL', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'MATRIX_CONTENT_CONFIG', 'MATRIX_CONTENT_CACHE')}
        for key in ('CODEX_API_KEY', 'OPENAI_API_KEY', 'SANDBOX_CODEX_REASONING'):
            os.environ.pop(key, None)
        os.environ.update(SANDBOX_AI_MODE='codex-cli', SANDBOX_CODEX_EXE=str(self.codex), SANDBOX_CODEX_MODEL='gpt-5.6-sol',
                          SCHOOL_CODEX_EXE=str(self.codex), SCHOOL_CODEX_MODEL='gpt-5.6-sol')

    def setup(self):
        super().setup()
        print('OWNED ENDPOINTS: Matrix ' + self.matrix_url + ' ; School ' + self.school_url, flush=True)

    def start_school(self):
        self.school_starts += 1
        imports = {key: (self.school_source / value).as_uri() for key, value in {
            'repository': 'src/server/repository.ts', 'service': 'src/server/school-service.ts',
            'provider': 'src/server/providers.ts', 'http': 'src/server/http.ts'}.items()}
        launcher = self.run_dir / 'live-school-launcher.mts'
        launcher.write_text(f"""import {{ FileSchoolRepository }} from {json.dumps(imports['repository'])};
import {{ SchoolService }} from {json.dumps(imports['service'])};
import {{ CodexMentorProvider }} from {json.dumps(imports['provider'])};
import {{ createSchoolServer }} from {json.dumps(imports['http'])};
const service = new SchoolService(new FileSchoolRepository({json.dumps(str(self.run_dir / 'school-data'))}), new CodexMentorProvider());
const server = createSchoolServer({{service}});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({{port: server.address().port}})));
process.stdin.once('data', () => {{service.close(); server.closeAllConnections(); server.close(() => process.exit(0));}});
""", encoding='utf-8')
        self.school_error = (self.run_dir / ('live-school-' + str(self.school_starts) + '.log')).open('w', encoding='utf-8')
        self.school = subprocess.Popen(['node', str(launcher)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.school_error,
                                       text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        first_line = queue.Queue()
        threading.Thread(target=lambda: first_line.put(self.school.stdout.readline()), daemon=True).start()
        line = first_line.get(timeout=15)
        if not line:
            raise AssertionError('Owned School startup failed; inspect private log')
        self.school_url = 'http://127.0.0.1:' + str(json.loads(line)['port'])

    def mentor_turn(self, phase, text):
        current = self.school_api(self.path)['session']
        started = self.school_api(self.path + '/turns', {'requestId': uuid.uuid4().hex,
            'expectedRevision': current['revision'], 'kind': 'question', 'text': text}, 202)
        result = self.wait(lambda: value if (value := self.school_api('/api/v1/turns/' + started['turn']['id']))['turn']['status'] != 'running' else None, timeout=145)
        (self.run_dir / (phase + '-private-turn.json')).write_text(json.dumps(result, indent=2), encoding='utf-8')
        turn = result['turn']
        self.check(turn['status'] == 'completed' and turn['receipt']['mode'] == 'codex-cli'
                   and turn['receipt']['completedTurn'] and turn['receipt']['toolCallCount'] == 0,
                   phase + ': actual Codex teaching turn completes without tools')
        self.report['mentorTurns'].append({'phase': phase, 'receipt': turn['receipt'],
            'outputSha256': BASE.hashlib.sha256(turn['output'].encode()).hexdigest(),
            'outputCharacters': len(turn['output']), 'hasDemonstration': bool(turn.get('demonstration'))})
        self.unchanged_lesson(result, phase + ': lesson stage and browser artifact remain unchanged')
        return result

    def run(self):
        self.setup()
        before_snapshot = self.matrix('/api/state')['snapshot']
        before = copy.deepcopy(before_snapshot['scene'])
        self.check(before['roomId'] == 'white-room-v1', 'Actual Windows runtime supplies the virtual White Room')
        self.check('codex-cli' in self.matrix('/api/v1/discovery')['capabilities']['scene.propose_text']['modes'], 'Matrix advertises its owner-configured AI text planner')
        session = self.school_api('/api/v1/sessions', {'requestId': uuid.uuid4().hex, 'mentorId': 'galileo', 'lessonId': 'observation-and-scale'}, 201)['session']
        self.path = '/api/v1/sessions/' + session['id']
        self.initial_session = copy.deepcopy(session)
        suggestion = self.mentor_turn('suggestion', QUESTION)
        self.check(suggestion['turn'].get('demonstration', {}).get('kind') == 'matrix-scene', 'Live mentor returns a saved inert Matrix teaching suggestion')
        self.check(self.scene() == before and self.matrix('/api/state')['pendingCount'] == 0 and not self.matrix('/api/v1/operator')['sessions'], 'Mentor suggestion alone neither pairs nor mutates the actual Matrix scene')
        code = self.matrix('/api/v1/pairings', {'clientName': 'Owned live mentor Windows acceptance'})
        self.pairing_code = code['pairingCode']
        paired = self.school_api(self.path + '/matrix/pair', {'requestId': uuid.uuid4().hex,
            'expectedRevision': suggestion['session']['revision'], 'url': self.matrix_url, 'pairingCode': self.pairing_code})
        self.matrix_session_id = paired['bridge']['binding']['matrixSessionId']
        self.binding_id = paired['bridge']['binding']['id']
        self.check(paired['bridge']['sceneBuilder']['available'], 'School advertises scene-building only after actual pairing and AI discovery')
        request_id = uuid.uuid4().hex
        payload = {'requestId': request_id, 'expectedRevision': paired['session']['revision'], 'bindingId': self.binding_id,
                   'expectedMatrixRevision': paired['bridge']['sceneBuilder']['expectedMatrixRevision'], 'turnId': suggestion['turn']['id']}
        submitted = self.school_api(self.path + '/matrix/scene-builds', payload)
        self.check(submitted['sceneBuild']['status'] in ('planning', 'ready'), 'Explicit School send submits the saved intent to Matrix AI planning')
        planned = self.wait(lambda: value if (value := self.school_api(self.path + '/matrix/scene-builds/' + request_id))['sceneBuild']['status'] != 'planning' else None, timeout=115)
        (self.run_dir / 'planned-private.json').write_text(json.dumps(planned, indent=2), encoding='utf-8')
        self.check(planned['sceneBuild']['status'] == 'ready' and planned['sceneBuild']['requiresApply'] and planned['sceneBuild']['observed'] is None, 'AI scene planning remains unexecuted and requires owner Apply')
        owner = self.owner_proposal(request_id)
        (self.run_dir / 'owner-proposal-private.json').write_text(json.dumps(owner, indent=2), encoding='utf-8')
        commands = owner['proposal']['commands']
        self.check(owner['proposal']['mode'] == 'codex-cli' and owner['proposal'].get('inference', {}).get('toolCallCount') == 0, 'Matrix proposal has an actual completed tool-free Codex inference receipt')
        self.check(allowed_commands(commands, before_snapshot), 'Complete proposal allows only two small separate built-in blocks with a two-to-one width comparison')
        self.check(self.scene() == before and self.matrix('/api/state')['pendingCount'] == 0, 'Actual Unity remains unchanged before the harness owner Apply')
        self.report['matrixInference'] = owner['proposal']['inference']
        self.report['reviewedCommands'] = commands
        self.owner_apply(request_id)
        observed = self.wait(lambda: value if (value := self.school_api(self.path + '/matrix/scene-builds/' + request_id))['sceneBuild']['status'] not in ('planning', 'ready', 'queued', 'running') else None)
        build = observed['sceneBuild']
        self.check(build['status'] == 'succeeded' and build['observed']['source'] == 'matrix-runtime'
                   and build['observed']['confirmedCommandCount'] == 2 and build['observed']['failedCommandCount'] == 0,
                   'School records two successful actual Unity command receipts and an acknowledging snapshot')
        current = self.scene()
        ids = [receipt['objectId'] for receipt in build['receipts']]
        self.check(len(set(ids)) == 2 and all(receipt['ok'] for receipt in build['receipts'])
                   and len(current['objects']) == len(before['objects']) + 2, 'Actual runtime adds exactly the two acknowledged objects')
        for original in before['objects']:
            self.check(next((item for item in current['objects'] if item['objectId'] == original['objectId']), None) == original, 'An existing runtime object remains unchanged')
        for receipt, command in zip(build['receipts'], commands):
            actual = next(item for item in current['objects'] if item['objectId'] == receipt['objectId'])
            self.check(actual['assetId'] == 'block' and actual['anchorId'] == command['anchorId'] and BASE.same_transform(actual['transform'], command['transform']), 'Acknowledged block identity and transform match the reviewed command')
        self.unchanged_lesson(observed, 'Confirmed scene commands do not advance the lesson or browser artifact')
        self.report['outcomes'] = [{'status': build['status'], 'observed': build['observed'], 'receiptCount': len(build['receipts']), 'teachingGoalVerified': False}]
        reflection = self.mentor_turn('reflection', REFLECTION)
        self.check(self.scene() == current and self.matrix('/api/state')['pendingCount'] == 0, 'Mentor reflection triggers no additional scene request or mutation')
        raw = (self.run_dir / 'school-data/school-store.json').read_text(encoding='utf-8')
        self.check(self.owner not in raw and self.pairing_code not in raw and 'clientToken' not in raw and '"snapshot"' not in raw,
                   'Durable lesson excludes pairing secrets and full room snapshots')
        self.report.update(status='passed', lessonStage=reflection['session']['stage'], lessonStageUnchanged=True,
                           browserArtifactUnchanged=True, liveInferenceCalls=3)

    def close(self):
        # Matrix's existing bounded CLI call must finish before its owning process
        # exits, even on a failed acceptance assertion. No external PID is killed.
        if self.server is not None:
            worker = self.server.state.clients.ai_worker
            if worker.acquire(timeout=115):
                worker.release()
            else:
                self.report.update(status='failed', matrixWorkerCleanup='Provider worker did not settle within its documented bound')
        try:
            super().close()
        finally:
            for name, value in self.old_environment.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--self-test', action='store_true')
    action.add_argument('--run-live', action='store_true')
    parser.add_argument('--matrix-checkout', type=Path)
    parser.add_argument('--player', type=Path)
    parser.add_argument('--codex-exe', type=Path)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not all((args.matrix_checkout, args.player, args.codex_exe)):
        parser.error('--run-live requires --matrix-checkout, --player and --codex-exe')
    check = MentorAcceptance(args)
    try:
        check.run()
    except Exception as error:
        check.report['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        check.close()


if __name__ == '__main__':
    main()
