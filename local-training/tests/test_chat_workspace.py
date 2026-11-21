"""Workspace unit tests; browser and Windows acceptance remain separate."""
import errno
import importlib.util
import pathlib
import types
import unittest

path = pathlib.Path(__file__).resolve().parents[1] / 'chat_workspace.py'
spec = importlib.util.spec_from_file_location('workspace_candidate', path)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class WorkspaceTests(unittest.TestCase):
    def test_disconnects_are_not_retried(self):
        for code in (errno.EPIPE, errno.ECONNRESET, errno.ECONNABORTED):
            calls = []
            def reply(self, *args):
                calls.append(args)
                raise OSError(code, 'disconnected')
            obj = types.SimpleNamespace(close_connection=False)
            self.assertIsNone(w.disconnect_safe(reply)(obj, 200, {}))
            self.assertEqual(len(calls), 1)
            self.assertTrue(obj.close_connection)

    def test_windows_abort(self):
        exc = OSError('aborted')
        exc.winerror = 10053
        def reply(self):
            raise exc
        obj = types.SimpleNamespace(close_connection=False)
        w.disconnect_safe(reply)(obj)
        self.assertTrue(obj.close_connection)

    def test_unrelated_errors_remain_visible(self):
        def reply(self):
            raise OSError(errno.EACCES, 'denied')
        with self.assertRaises(PermissionError):
            w.disconnect_safe(reply)(object())

    def test_success_passthrough(self):
        self.assertEqual(w.disconnect_safe(lambda self, value: value)(object(), 42), 42)

    def test_guard_wraps_existing_factory(self):
        class Parent:
            def reply(self, *args):
                return args
        server = types.SimpleNamespace(RequestHandlerClass=Parent)
        console = types.SimpleNamespace(make_server=lambda *a, **kw: (server, 'fixture'))
        w.install_guard(console)
        actual, token = console.make_server('supervisor', 8767)
        self.assertIs(actual, server)
        self.assertEqual(token, 'fixture')
        self.assertTrue(issubclass(server.RequestHandlerClass, Parent))
        self.assertEqual(server.RequestHandlerClass().reply(200), (200,))

    def test_ui_uses_text_nodes_not_html_insertion(self):
        self.assertNotIn('innerHTML', w.PANEL)
        self.assertNotIn('localStorage', w.PANEL)
        self.assertIn('document.createTextNode', w.PANEL)
        self.assertIn('agents.length', w.PANEL)
        self.assertIn('timestamp unavailable', w.PANEL)
        self.assertIn('no automatic retry', w.PANEL)


if __name__ == '__main__':
    unittest.main()
