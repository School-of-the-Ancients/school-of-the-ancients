"""Opt-in actual Windows acceptance; requires an isolated Matrix validation player.

Run from this School checkout with Python 3.10+ and Node 24 on PATH:
  python examples/verify-matrix-scale-windows.py --matrix-checkout <Matrix>
      --player <isolated MatrixOperator.exe>

The player must have product name 'Matrix Operator Validation <simple-id>'.
This starts only new loopback services and an owned player, uses authored demo
mentoring, and calls owner Apply after checking each exact command. It is not a
human UI or headset test. Private traces stay in ignored work/; report.json is
sanitized. Never point this runner at a normal application build.
"""
import argparse
import copy
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def sha(path, normalize=False):
    raw = path.read_bytes()
    return hashlib.sha256(raw.replace(b'\r\n', b'\n') if normalize else raw).hexdigest()


def revision(path):
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=path, text=True).strip()


def same_transform(a, b):
    return all(math.isclose(a[part][axis], b[part][axis], abs_tol=1e-5, rel_tol=1e-5)
               for part in ('position', 'rotation', 'scale') for axis in ('x', 'y', 'z'))


class Acceptance:
    def __init__(self, args):
        if os.name != 'nt':
            raise ValueError('This acceptance runner requires Windows.')
        self.matrix_root = args.matrix_checkout.resolve(strict=True)
        self.player_path = args.player.resolve(strict=True)
        self.run_dir = ROOT / 'work' / ('school-scale-windows-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:4])
        self.run_dir.mkdir(parents=True, exist_ok=False)
        self.owner = secrets.token_urlsafe(32)
        self.player = self.school = self.server = self.control = None
        self.school_error = None
        self.school_starts = 0
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.report = {'schemaVersion': 1, 'status': 'failed', 'startedUtc': self.now(), 'checks': [],
                       'scope': 'Actual School HTTP to Matrix HTTP to isolated headless Windows Unity',
                       'schoolBaseCommit': revision(ROOT), 'matrixCommit': revision(self.matrix_root),
                       'runnerSha256': sha(Path(__file__), True), 'pythonVersion': sys.version.split()[0],
                       'nodeVersion': subprocess.check_output(['node', '--version'], text=True).strip(),
                       'mentorProvider': 'authored demo', 'syntheticRuntimeUsed': False,
                       'humanClickedApply': False, 'ownerApply': 'Authenticated owner endpoint after exact proposal inspection',
                       'headsetTested': False, 'renderingInspected': False, 'physicalMeasurement': False,
                       'schoolBrowserUiTested': False, 'outcomes': []}

    @staticmethod
    def now():
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

    def check(self, condition, message):
        if not condition:
            raise AssertionError(message)
        self.report['checks'].append(message)
        print('SCHOOL SCALE: ' + message, flush=True)

    def request(self, origin, path, body=None, owner=False, expected=200):
        headers = {'Content-Type': 'application/json'}
        if owner:
            headers['Authorization'] = 'Bearer ' + self.owner
        req = urllib.request.Request(origin + path, data=None if body is None else json.dumps(body, allow_nan=False).encode(), headers=headers)
        try:
            with self.http.open(req, timeout=15) as response:
                status, value = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            status, value = error.code, json.load(error)
        if status != expected:
            raise AssertionError(path + ': expected HTTP ' + str(expected) + ', got ' + str(status) + ', code=' + str(value.get('code')))
        return value

    def matrix(self, path, body=None, expected=200):
        return self.request(self.matrix_url, path, body, True, expected)

    def school_api(self, path, body=None, expected=200):
        return self.request(self.school_url, path, body, False, expected)

    def wait(self, callback, timeout=40):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = callback()
            if result:
                return result
            for child in (self.player, self.school):
                if child is not None and child.poll() is not None:
                    raise AssertionError('Owned acceptance process exited unexpectedly; inspect private logs')
            time.sleep(.15)
        raise TimeoutError('Owned acceptance did not settle')

    def setup(self):
        data = self.player_path.with_name(self.player_path.stem + '_Data')
        company, product = (data / 'app.info').read_text().splitlines()
        self.check(company == 'School of the Ancients' and re.fullmatch(r'Matrix Operator Validation [A-Za-z0-9_-]{1,48}', product) is not None,
                   'Player has an explicit isolated validation product identity')
        self.profile = Path(os.environ['USERPROFILE']) / 'AppData/LocalLow' / company / product
        self.profile.mkdir(parents=True, exist_ok=True)
        cache = self.profile / 'content-packs-v1'
        self.cache_hashes = {f.name: sha(f) for f in cache.glob('*') if f.is_file()}
        self.report['player'] = {'target': 'StandaloneWindows64', 'exeSha256': sha(self.player_path),
                                 'runtimeAssemblySha256': sha(data / 'Managed/Assembly-CSharp.dll')}
        self.school_source = self.run_dir / 'school-source'
        self.school_source.mkdir()
        shutil.copytree(ROOT / 'src', self.school_source / 'src')
        shutil.copy2(ROOT / 'package.json', self.school_source / 'package.json')
        self.matrix_source = self.run_dir / 'ControlService'
        shutil.copytree(self.matrix_root / 'ControlService', self.matrix_source, ignore=shutil.ignore_patterns('__pycache__', 'scenes'))
        self.report['sourceHashNormalization'] = 'UTF-8 source bytes with CRLF converted to LF'
        self.report['schoolSourceSha256'] = {f.relative_to(self.school_source).as_posix(): sha(f, True) for f in sorted(self.school_source.rglob('*')) if f.is_file()}
        self.report['matrixSourceSha256'] = {'ControlService/' + f.name: sha(f, True) for f in sorted(self.matrix_source.glob('*.py')) if not f.name.startswith('test_')}
        config = self.run_dir / 'content-config.json'
        config.write_text(json.dumps({'schemaVersion': 1, 'providers': []}), encoding='utf-8')
        os.environ['MATRIX_CONTENT_CONFIG'] = str(config)
        os.environ['MATRIX_CONTENT_CACHE'] = str(self.run_dir / 'content-cache')
        sys.path.insert(0, str(self.matrix_source))
        from server import Server, State
        self.server = Server(('127.0.0.1', 0), State(self.run_dir / 'scenes'), self.owner)
        self.matrix_url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.control = self.profile / 'control.json'
        self.control_bytes = json.dumps({'url': self.matrix_url, 'token': self.owner}).encode()
        # A pre-existing configuration is never overwritten or removed.
        with self.control.open('xb') as target:
            target.write(self.control_bytes)
        self.owns_control = True
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        self.player = subprocess.Popen([str(self.player_path), '-batchmode', '-nographics', '-serviceUrl', self.matrix_url,
                                        '-logFile', str(self.run_dir / 'player.log')], startupinfo=startup, creationflags=subprocess.CREATE_NO_WINDOW)
        self.wait(lambda: value if (value := self.matrix('/api/state')).get('online') and value.get('snapshot') else None)
        self.start_school()

    def start_school(self):
        self.school_starts += 1
        imports = {key: (self.school_source / value).as_uri() for key, value in {
            'repository': 'src/server/repository.ts', 'service': 'src/server/school-service.ts',
            'provider': 'src/server/providers.ts', 'http': 'src/server/http.ts'}.items()}
        launcher = self.run_dir / 'school-launcher.mts'
        launcher.write_text(f"""import {{ FileSchoolRepository }} from {json.dumps(imports['repository'])};
import {{ SchoolService }} from {json.dumps(imports['service'])};
import {{ DemoMentorProvider }} from {json.dumps(imports['provider'])};
import {{ createSchoolServer }} from {json.dumps(imports['http'])};
const service = new SchoolService(new FileSchoolRepository({json.dumps(str(self.run_dir / 'school-data'))}), new DemoMentorProvider(0));
const server = createSchoolServer({{service}});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({{port: server.address().port}})));
process.stdin.once('data', () => {{service.close(); server.closeAllConnections(); server.close(() => process.exit(0));}});
""", encoding='utf-8')
        self.school_error = (self.run_dir / ('school-' + str(self.school_starts) + '.log')).open('w', encoding='utf-8')
        self.school = subprocess.Popen(['node', str(launcher)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.school_error,
                                       text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        first_line = queue.Queue()
        threading.Thread(target=lambda: first_line.put(self.school.stdout.readline()), daemon=True).start()
        line = first_line.get(timeout=15)
        if not line:
            raise AssertionError('School startup failed; inspect private log')
        self.school_url = 'http://127.0.0.1:' + str(json.loads(line)['port'])

    def stop_school(self):
        try:
            if self.school is not None and self.school.poll() is None:
                try:
                    self.school.stdin.write('x')
                    self.school.stdin.flush()
                except (OSError, ValueError):
                    # It can exit between poll and write. Only this owned child
                    # is eligible for termination; never look up a service PID.
                    self.terminate_owned(self.school)
                else:
                    try:
                        self.school.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        self.terminate_owned(self.school)
        finally:
            if self.school is not None and self.school.poll() is not None:
                self.school = None
            if self.school_error:
                self.school_error.close()
                self.school_error = None

    @staticmethod
    def terminate_owned(child):
        if child.poll() is None:
            child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)

    def scene(self):
        return self.matrix('/api/state')['snapshot']['scene']

    def object(self):
        return next(item for item in self.scene()['objects'] if item['objectId'] == self.object_id)

    def owner_proposal(self, request_id):
        sessions = self.matrix('/api/v1/operator')['sessions']
        paired = next(s for s in sessions if s['sessionId'] == self.matrix_session_id)
        return next(r for r in paired['requests'] if r['requestId'] == request_id)

    def owner_apply(self, request_id):
        return self.matrix('/api/v1/operator/requests/' + self.matrix_session_id + '/' + request_id + '/apply', {})

    def unchanged_lesson(self, value, message):
        self.check(value['session']['stage'] == self.initial_session['stage'] and value['session']['artifact'] == self.initial_session['artifact'], message)

    def placement(self):
        initial = copy.deepcopy(self.scene())
        self.check(initial['roomId'] == 'white-room-v1', 'Actual Unity supplies the White Room, without synthetic runtime exchange')
        session = self.school_api('/api/v1/sessions', {'requestId': uuid.uuid4().hex, 'mentorId': 'galileo', 'lessonId': 'observation-and-scale'}, 201)['session']
        self.initial_session = copy.deepcopy(session)
        self.path = '/api/v1/sessions/' + session['id']
        code = self.matrix('/api/v1/pairings', {'clientName': 'Owned School scale Windows acceptance'})
        paired = self.school_api(self.path + '/matrix/pair', {'requestId': uuid.uuid4().hex, 'expectedRevision': session['revision'], 'url': self.matrix_url, 'pairingCode': code['pairingCode']})
        self.pairing_code = code['pairingCode']
        self.binding_id = paired['bridge']['binding']['id']
        self.matrix_session_id = paired['bridge']['binding']['matrixSessionId']
        self.check(paired['bridge']['readiness']['canLaunch'], 'School verifies readiness using the actual runtime block catalog and selection')
        self.demonstration_id = uuid.uuid4().hex
        request = {'requestId': self.demonstration_id, 'expectedRevision': paired['session']['revision'], 'bindingId': self.binding_id,
                   'expectedMatrixRevision': paired['bridge']['readiness']['matrixRequest']['revision']}
        proposal = self.school_api(self.path + '/matrix/demonstrations', request)
        self.check(proposal['demonstration']['status'] == 'ready' and proposal['demonstration']['requiresApply'], 'School placement waits for owner review')
        time.sleep(.7)
        self.check(self.scene() == initial and self.matrix('/api/state')['pendingCount'] == 0, 'Placement proposal leaves actual Unity unchanged before Apply')
        commands = self.owner_proposal(self.demonstration_id)['proposal']['commands']
        self.check(len(commands) == 1 and commands[0]['op'] == 'spawn' and commands[0]['assetId'] == 'block', 'Owner reviews exactly one built-in block placement')
        self.owner_apply(self.demonstration_id)
        result = self.wait(lambda: value if (value := self.school_api(self.path + '/matrix/demonstrations/' + self.demonstration_id))['demonstration']['status'] not in ('planning', 'ready', 'queued', 'running') else None)
        self.check(result['demonstration']['status'] == 'succeeded' and len(result['demonstration']['observed']['objects']) == 1, 'School confirms placement from the actual Unity receipt and snapshot')
        self.object_id = result['demonstration']['observed']['objects'][0]['objectId']
        self.original = copy.deepcopy(self.object()['transform'])
        self.unchanged_lesson(result, 'Confirmed placement preserves lesson stage and browser artifact')

    def experiment(self, reset=False, baseline=None):
        ready = self.school_api(self.path + '/matrix')
        self.check(ready['bridge']['scale']['available'], ('Reset' if reset else 'Scale') + ' readiness uses the confirmed lesson block and current runtime revision')
        request_id = uuid.uuid4().hex
        request = {'requestId': request_id, 'expectedRevision': ready['session']['revision'], 'bindingId': self.binding_id,
                   'expectedMatrixRevision': ready['bridge']['scale']['expectedMatrixRevision'], 'demonstrationId': self.demonstration_id,
                   'action': 'reset' if reset else 'configure'}
        factors = {'x': 1, 'y': 1, 'z': 1} if reset else {'x': 2, 'y': 2, 'z': 2}
        if reset:
            request['baselineExperimentId'] = baseline
        else:
            request['factors'] = factors
        before = copy.deepcopy(self.scene())
        proposed = self.school_api(self.path + '/matrix/experiments', request)
        self.check(proposed['experiment']['status'] == 'ready' and proposed['experiment']['requiresApply'] and proposed['experiment']['observed'] is None,
                   request['action'] + ': School has an unapplied proposal and no claimed observation')
        time.sleep(.7)
        self.check(self.scene() == before and self.matrix('/api/state')['pendingCount'] == 0, request['action'] + ': real Unity remains unchanged before owner Apply')
        commands = self.owner_proposal(request_id)['proposal']['commands']
        expected = copy.deepcopy(self.original)
        for axis in ('x', 'y', 'z'):
            expected['scale'][axis] *= factors[axis]
        self.check(len(commands) == 1 and commands[0]['op'] == 'set_transform' and commands[0]['objectId'] == self.object_id and same_transform(commands[0]['transform'], expected),
                   request['action'] + ': owner verifies the exact target and original-baseline transform')
        self.owner_apply(request_id)
        result = self.wait(lambda: value if (value := self.school_api(self.path + '/matrix/experiments/' + request_id))['experiment']['status'] not in ('planning', 'ready', 'queued', 'running') else None)
        (self.run_dir / (request['action'] + '-private-outcome.json')).write_text(json.dumps(result, indent=2), encoding='utf-8')
        experiment = result['experiment']
        self.check(experiment['status'] == 'succeeded' and experiment['observed'] is not None, request['action'] + ': School records confirmed runtime scale evidence')
        evidence = experiment['observed']
        actual = self.object()['transform']
        ratios = {axis: actual['scale'][axis] / self.original['scale'][axis] for axis in ('x', 'y', 'z')}
        ratio = math.prod(ratios.values())
        self.check(same_transform(actual, expected) and math.isclose(ratio, 1 if reset else 8, rel_tol=1e-5)
                   and math.isclose(evidence['mathematicalVolumeRatio'], ratio, rel_tol=1e-5)
                   and all(math.isclose(evidence['relativeFactors'][axis], ratios[axis], rel_tol=1e-5) for axis in ratios),
                   request['action'] + ': School ratio matches independently calculated actual Unity scale')
        self.check(evidence['source'] == 'acknowledged-runtime-transform' and evidence['physicalMeasurement'] is False and evidence['units'] == 'dimensionless ratio'
                   and len(experiment['receipts']) == 1 and experiment['receipts'][0]['ok'] and experiment['receipts'][0]['objectId'] == self.object_id,
                   request['action'] + ': saved evidence is tied to the real command receipt and discloses mathematical units')
        self.unchanged_lesson(result, request['action'] + ': success preserves lesson stage and independent browser artifact')
        self.report['outcomes'].append({'action': request['action'], 'status': experiment['status'], 'receiptCount': len(experiment['receipts']),
                                        'observedScale': actual['scale'], 'relativeFactors': evidence['relativeFactors'],
                                        'mathematicalVolumeRatio': evidence['mathematicalVolumeRatio'], 'physicalMeasurement': False})
        return result

    def run(self):
        self.setup()
        self.placement()
        configured = self.experiment()
        reset = self.experiment(True, configured['experiment']['id'])
        self.check(same_transform(self.object()['transform'], self.original), 'Reviewed reset restores original position rotation and scale')
        self.check(len(reset['bridge']['experiments']) == 2, 'Both reviewed experiment records remain in the School history')
        raw = (self.run_dir / 'school-data/school-store.json').read_text(encoding='utf-8')
        self.check(self.owner not in raw and self.pairing_code not in raw and 'clientToken' not in raw and '"snapshot"' not in raw,
                   'Durable School history excludes pairing secrets and full runtime snapshots')
        saved_scene = copy.deepcopy(self.scene())
        self.stop_school()
        self.start_school()
        resumed = self.school_api(self.path)
        experiments = resumed['session']['matrix']['experiments']
        self.check(len(experiments) == 2 and [x['observed'] for x in experiments] == [configured['experiment']['observed'], reset['experiment']['observed']],
                   'Restarted School preserves both original confirmed scale observations')
        self.unchanged_lesson(resumed, 'School restart preserves the independent lesson stage and browser artifact')
        status = self.school_api(self.path + '/matrix')
        time.sleep(.7)
        self.check(not status['bridge']['connected'] and not status['bridge']['scale']['available'] and self.scene() == saved_scene and self.matrix('/api/state')['pendingCount'] == 0,
                   'School restart withdraws pairing readiness and does not replay runtime work')
        self.report.update(status='passed', schoolProcessStarts=self.school_starts, lessonStage=resumed['session']['stage'],
                           lessonStageUnchanged=True, browserArtifactUnchanged=True, originalScale=self.original['scale'])

    def close(self):
        failures = []
        def attempt(label, action):
            try:
                action()
            except Exception as error:
                # Cleanup must proceed independently for every owned resource.
                # Avoid copying OS diagnostics or paths into published reports.
                failures.append(label + ': ' + type(error).__name__)
        attempt('School shutdown', self.stop_school)
        if self.player is not None:
            attempt('Player shutdown', lambda: self.terminate_owned(self.player))
        if self.server is not None:
            thread = getattr(self, 'thread', None)
            running = thread is not None and thread.is_alive()
            if running:
                attempt('Matrix shutdown', self.server.shutdown)
            attempt('Matrix socket close', self.server.server_close)
            if running:
                attempt('Matrix thread join', lambda: thread.join(timeout=5))
        def remove_control():
            if getattr(self, 'owns_control', False) and self.control.exists() and self.control.read_bytes() == self.control_bytes:
                self.control.unlink()
        attempt('Temporary credential removal', remove_control)
        if hasattr(self, 'cache_hashes'):
            cache = self.profile / 'content-packs-v1'
            attempt('Cache verification', lambda: self.check(self.cache_hashes == {f.name: sha(f) for f in cache.glob('*') if f.is_file()}, 'Isolated player content cache remains byte-identical'))
        log = self.run_dir / 'player.log'
        if log.exists():
            engine = re.search(r'Initialize engine version: ([A-Za-z0-9.]+)', log.read_text(encoding='utf-8', errors='replace'))
            if engine:
                self.report['player']['unityVersion'] = engine.group(1)
        self.report['cleanup'] = {'ownedPlayerStopped': self.player is None or self.player.poll() is not None,
                                   'ownedSchoolStopped': self.school is None or self.school.poll() is not None,
                                   'ownedMatrixStopped': self.server is None or getattr(self, 'thread', None) is None or not self.thread.is_alive(),
                                   'temporaryControlRemoved': not getattr(self, 'owns_control', False) or not self.control.exists()}
        if failures or not all(self.report['cleanup'].values()):
            self.report['status'] = 'failed'
            self.report['cleanupErrors'] = failures or ['An owned resource could not be released safely.']
        self.report['completedUtc'] = self.now()
        (self.run_dir / 'report.json').write_text(json.dumps(self.report, indent=2) + '\n', encoding='utf-8')
        print('REPORT: ' + str(self.run_dir / 'report.json'), flush=True)
        if self.report.get('cleanupErrors'):
            raise RuntimeError('Acceptance cleanup needs attention; inspect the report.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--matrix-checkout', type=Path, required=True)
    parser.add_argument('--player', type=Path, required=True)
    args = parser.parse_args()
    check = Acceptance(args)
    try:
        check.run()
    except Exception as error:
        check.report['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        check.close()


if __name__ == '__main__':
    main()
