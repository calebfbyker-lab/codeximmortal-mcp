import importlib.util, json, pathlib, tempfile, threading, time, unittest, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('agent_console',ROOT/'agent_console.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.home=pathlib.Path(self.tmp.name)
        self.worker=self.home/'worker.py'
        self.worker.write_text("import time; print('real subprocess output',flush=True); time.sleep(.2)")
        self.s=m.Supervisor(self.home,self.worker)
    def tearDown(self): self.s.close();self.tmp.cleanup()
    def test_real_process_and_persistent_events(self):
        self.s.start('observer')
        for t in self.s.threads:t.join(5)
        snap=self.s.snapshot()
        self.assertEqual(snap['agents'][0]['exit_code'],0)
        self.assertTrue(any('real subprocess output' in e['text'] for e in snap['events']))
        self.assertTrue((self.home/'console.sqlite3').exists())
    def test_pause_and_unknown(self):
        self.s.paused=True
        with self.assertRaises(ValueError):self.s.start('observer')
        with self.assertRaises(ValueError):self.s.start('shell')
    def test_restart_cannot_interrupt(self):
        self.s.start('observer')
        with self.assertRaises(ValueError):self.s.start('observer')
    def test_metrics_and_cursor(self):
        snap=self.s.snapshot();self.assertIsNone(snap['agents'][0]['cpu_percent'])
        last=snap['events'][-1]['id'];self.assertEqual(self.s.snapshot(last)['events'],[])
    def test_http_auth_and_allowlist(self):
        server,token=m.make_server(self.s,0,'test-token');thread=threading.Thread(target=server.serve_forever);thread.start()
        url='http://127.0.0.1:'+str(server.server_port)
        def call(path,auth):
            req=urllib.request.Request(url+'/api/'+path,data=b'{}',headers={'Origin':url,'Authorization':'Bearer '+auth})
            return urllib.request.urlopen(req,timeout=3)
        try:
            with self.assertRaises(urllib.error.HTTPError) as e:call('status','wrong')
            self.assertEqual(e.exception.code,403)
            with call('status',token) as r:self.assertIn('agents',json.load(r))
            with self.assertRaises(urllib.error.HTTPError) as e:call('shell',token)
            self.assertEqual(e.exception.code,404)
        finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':unittest.main()
