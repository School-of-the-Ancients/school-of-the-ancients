"""Owned-resource cleanup failures must not strand the remaining test fixture."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

PATH = Path(__file__).resolve().parents[1] / 'examples/verify-matrix-scale-windows.py'
SPEC = importlib.util.spec_from_file_location('windows_acceptance', PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Child:
    def __init__(self, *, broken_pipe=False, refuses_stop=False, requires_kill=False):
        self.stopped = False
        self.refuses_stop = refuses_stop
        self.requires_kill = requires_kill
        self.terminated = self.killed = False
        self.stdin = SimpleNamespace(write=self.write, flush=lambda: None)
        self.broken_pipe = broken_pipe

    def poll(self):
        return 0 if self.stopped else None

    def write(self, value):
        if self.broken_pipe:
            raise BrokenPipeError('Child exited between status and stdin write')
        self.stopped = True

    def terminate(self):
        self.terminated = True
        if self.refuses_stop:
            raise PermissionError('Simulated inability to terminate owned child')
        self.stopped = not self.requires_kill

    def kill(self):
        self.killed = self.stopped = True

    def wait(self, timeout):
        if not self.stopped:
            raise subprocess.TimeoutExpired('owned-child', timeout)
        return 0


class CleanupTests(unittest.TestCase):
    def fixture(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        check = MODULE.Acceptance.__new__(MODULE.Acceptance)
        check.run_dir = Path(folder.name)
        check.report = {'status': 'passed', 'checks': []}
        check.school = Child(broken_pipe=True)
        check.school_error = io.StringIO()
        check.player = Child()
        lifecycle = {'running': True, 'socketClosed': False, 'joined': False}
        check.thread = SimpleNamespace(is_alive=lambda: lifecycle['running'], join=lambda **kwargs: lifecycle.update(joined=True))
        check.server = SimpleNamespace(shutdown=lambda: lifecycle.update(running=False), server_close=lambda: lifecycle.update(socketClosed=True))
        check.control = check.run_dir / 'control.json'
        check.control_bytes = b'{"token":"temporary-fixture-secret"}'
        check.control.write_bytes(check.control_bytes)
        check.owns_control = True
        return check, lifecycle

    def test_broken_stdin_still_stops_every_owned_process_socket_and_removes_own_token(self):
        check, lifecycle = self.fixture()
        school, player = check.school, check.player
        check.close()
        self.assertTrue(school.terminated and player.terminated)
        self.assertTrue(lifecycle['socketClosed'] and lifecycle['joined'])
        self.assertFalse(check.control.exists())
        self.assertTrue(all(check.report['cleanup'].values()))
        self.assertEqual(json.loads((check.run_dir / 'report.json').read_text())['status'], 'passed')

    def test_school_shutdown_failure_does_not_skip_player_server_or_credential_cleanup(self):
        check, lifecycle = self.fixture()
        check.school.refuses_stop = True
        with self.assertRaisesRegex(RuntimeError, 'cleanup needs attention'):
            check.close()
        self.assertTrue(check.player.terminated and lifecycle['socketClosed'])
        self.assertFalse(check.control.exists())
        self.assertFalse(check.report['cleanup']['ownedSchoolStopped'])
        self.assertEqual(check.report['status'], 'failed')
        self.assertEqual(check.report['cleanupErrors'], ['School shutdown: PermissionError'])

    def test_existing_or_replaced_configuration_is_never_deleted(self):
        for previously_owned in (False, True):
            with self.subTest(previously_owned=previously_owned):
                check, _ = self.fixture()
                check.owns_control = previously_owned
                original = b'{"token":"unrelated-existing-configuration"}'
                check.control.write_bytes(original)
                if previously_owned:
                    with self.assertRaises(RuntimeError):
                        check.close()
                else:
                    check.close()
                self.assertEqual(check.control.read_bytes(), original)

    def test_unresponsive_owned_player_is_killed_after_bounded_termination_wait(self):
        check, _ = self.fixture()
        check.player.requires_kill = True
        check.close()
        self.assertTrue(check.player.terminated and check.player.killed)
        self.assertTrue(all(check.report['cleanup'].values()))


if __name__ == '__main__':
    unittest.main()
