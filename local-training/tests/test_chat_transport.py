"""Real loopback HTTP fixtures; no Ollama or GPU required."""
import http.client, http.server, importlib.util, json, pathlib, threading, time, unittest
from unittest import mock
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('chat_transport_candidate',ROOT/'chat_transport.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TransportTests(unittest.TestCase):
    def run_stream(self,scenario,**kwargs):
        received=[];output=[];stages=[];usage=[]
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                try:scenario(self)
                except (BrokenPipeError,ConnectionResetError,OSError):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
        def factory(host,port,timeout):return http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=timeout)
        try:
            m.stream('fixture',[{'role':'user','content':'hello'}],output.append,stages.append,usage.append,
                     factory=factory,**kwargs)
            return received,output,stages,usage
        finally:server.shutdown();server.server_close();t.join()
    @staticmethod
    def record(h,row):h.wfile.write((json.dumps(row)+'\n').encode());h.wfile.flush()
    def test_delayed_headers_and_stream(self):
        def scenario(h):
            time.sleep(.06);h.send_response(200);h.end_headers()
            self.record(h,{'message':{'content':'hello'}});self.record(h,{'done':True,'eval_count':1})
        received,out,stage,usage=self.run_stream(scenario,idle=.5,total=1)
        self.assertEqual(out,['hello']);self.assertEqual(stage[-1],'completed')
        self.assertNotIn('think',received[0]);self.assertEqual(received[0]['keep_alive'],'5m')
        self.assertEqual(usage[0]['eval_count'],1)
    def test_idle_timeout(self):
        def scenario(h):time.sleep(.15);h.send_response(200);h.end_headers()
        with self.assertRaisesRegex(TimeoutError,'network progress'):self.run_stream(scenario,idle=.04,total=.5)
    def test_total_deadline_during_live_stream(self):
        def scenario(h):
            h.send_response(200);h.end_headers()
            for _ in range(200):self.record(h,{'message':{'thinking':'not exposed'}});time.sleep(.015)
        with self.assertRaisesRegex(TimeoutError,'Total generation'):self.run_stream(scenario,idle=.5,total=.5)
    def test_thinking_not_emitted(self):
        def scenario(h):
            h.send_response(200);h.end_headers();self.record(h,{'message':{'thinking':'private'}})
            self.record(h,{'message':{'content':'answer'},'done':True,'done_reason':'length'})
        received,out,stage,_=self.run_stream(scenario,think='off')
        self.assertFalse(received[0]['think']);self.assertEqual(out,['answer'])
        self.assertIn('model thinking; no answer yet',stage);self.assertIn('token limit',stage[-1])
    def test_missing_model(self):
        def scenario(h):h.send_response(404);h.end_headers();h.wfile.write(b'model not found')
        with self.assertRaisesRegex(ValueError,'404'):self.run_stream(scenario)
    def test_malformed_stream(self):
        def scenario(h):h.send_response(200);h.end_headers();h.wfile.write(b'not-json\n')
        with self.assertRaises(ValueError):self.run_stream(scenario)
    def test_thinking_without_answer(self):
        def scenario(h):h.send_response(200);h.end_headers();self.record(h,{'message':{'thinking':'private'},'done':True})
        with self.assertRaisesRegex(ValueError,'No answer text'):self.run_stream(scenario)
    def test_truncated_stream(self):
        def scenario(h):h.send_response(200);h.end_headers();self.record(h,{'message':{'content':'partial'}})
        with self.assertRaisesRegex(ValueError,'without done'):self.run_stream(scenario)
class DeadlineRaceTests(unittest.TestCase):
    def simulate(self,elapsed,record=None):
        clock=[0.0];connection=mock.Mock();response=connection.getresponse.return_value
        response.status=200;emitted=[]
        def read(limit):
            clock[0]=elapsed
            if record is not None:return (json.dumps(record)+'\n').encode()
            raise TimeoutError('socket deadline won the race')
        response.readline.side_effect=read
        with mock.patch.object(m.time,'monotonic',side_effect=lambda:clock[0]), \
             mock.patch.object(m.threading,'Timer') as timer:
            with self.assertRaisesRegex(TimeoutError,'Total generation' if elapsed>=2 else 'network progress'):
                m.stream('fixture',[],emitted.append,idle=1,total=2,factory=lambda *a,**k:connection)
            timer.return_value.start.assert_called_once()
            timer.return_value.cancel.assert_called_once()
        connection.close.assert_called_once();self.assertEqual(emitted,[])
    def test_socket_deadline_before_watchdog(self):self.simulate(2)
    def test_true_idle_timeout_is_not_total(self):self.simulate(1)
    def test_late_completed_record_is_rejected(self):
        self.simulate(2,{'message':{'content':'late'},'done':True})
if __name__=='__main__':unittest.main()
