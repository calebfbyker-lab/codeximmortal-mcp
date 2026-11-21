import http.client
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest

class DashboardPatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.c = {'home': Path(self.tmp.name), 'minimum_examples': 1}
        fake = types.ModuleType('lab')
        fake.rows = lambda p: [json.loads(s) for s in p.read_text().splitlines() if s.strip()]
        fake.load = lambda p: json.loads(p.read_text())
        fake.generate = fake.filter_data = fake.export_data = fake.make_plan = lambda c: {'mock': True}
        old = sys.modules.get('lab')
        sys.modules['lab'] = fake
        try:
            path = Path(__file__).resolve().parents[1] / 'dashboard_v2.py'
            spec = importlib.util.spec_from_file_location('dashboard_patch_test', path)
            self.m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.m)
        finally:
            if old is None:
                del sys.modules['lab']
            else:
                sys.modules['lab'] = old

    def tearDown(self):
        self.tmp.cleanup()

    def test_workspace_lock_and_cleanup(self):
        with self.m.workspace(self.c):
            with self.assertRaises(ValueError):
                with self.m.workspace(self.c):
                    pass
        self.assertFalse((self.c['home'] / 'companion.lock').exists())

    def test_training_lock(self):
        (self.c['home'] / 'training.lock').touch()
        with self.assertRaises(ValueError):
            self.m.run(self.c, 'generate')
        self.assertFalse((self.c['home'] / 'companion.lock').exists())

    def test_prerequisites(self):
        for data in ['', 'not json', '{}']:
            (self.c['home'] / 'raw.jsonl').write_text(data)
            with self.assertRaises((ValueError, KeyError)):
                self.m.prerequisite(self.c, 'filter')
        row = {'task_id': 'x', 'split': 'train', 'tasks_hash': 'x', 'messages': [{}]}
        (self.c['home'] / 'raw.jsonl').write_text(json.dumps(row))
        self.m.prerequisite(self.c, 'filter')

    def test_http_security_and_worker(self):
        server, token, workers = self.m.make_server(self.c, 0, 'test')
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        def request(path, method='POST', auth='test'):
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            conn.request(method, path, body=b'', headers={'Authorization': 'Bearer ' + auth,
                'Origin': 'http://127.0.0.1:%d' % server.server_port})
            r = conn.getresponse()
            body = r.read()
            conn.close()
            return r.status, body
        try:
            self.assertEqual(request('/')[0], 404)
            self.assertEqual(request('/', 'GET')[0], 200)
            self.assertEqual(request('/api/status', auth='bad')[0], 403)
            self.assertEqual(request('/api/train')[0], 404)
            self.assertEqual(request('/api/generate')[0], 202)
            for worker in workers:
                worker.join(3)
                self.assertFalse(worker.daemon)
                self.assertFalse(worker.is_alive())
            state = json.loads(request('/api/status')[1])
            self.assertTrue(state['last']['ok'])
            self.assertFalse(state['running'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

if __name__ == '__main__':
    unittest.main()
