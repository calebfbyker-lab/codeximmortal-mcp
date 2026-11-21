import importlib.util, pathlib, sys, tempfile, threading, types, unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('chat_console_candidate',ROOT/'chat_console.py')
m=importlib.util.module_from_spec(spec)
# Core unit tests intentionally mock console; HTTP integration is not covered.
with patch.dict(sys.modules,{'agent_console':types.ModuleType('agent_console')}):spec.loader.exec_module(m)
class SupervisorStub:
    def __init__(self):self.lock=threading.RLock();self.paused=False;self.closing=False;self.active=None
    def snapshot(self):return dict(repo='fixture',active=self.active,paused=self.paused,agents=[],repair='unavailable')
class ChatTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.home=pathlib.Path(self.tmp.name);self.s=SupervisorStub();self.chats=[]
    def create(self,fn):
        c=m.Chat(self.home,'test-model',fn);self.chats.append(c);return c
    def tearDown(self):
        for c in self.chats:c.close()
        self.tmp.cleanup()
    def test_response_and_history(self):
        seen=[]
        def infer(model,messages,emit):seen.append(messages);emit('hello');emit(' world')
        c=self.create(infer);c.send('first',self.s)
        for t in c.threads:t.join(2)
        c.send('second',self.s)
        for t in c.threads:t.join(2)
        self.assertEqual(c.snapshot()['messages'][-1]['content'],'hello world')
        self.assertTrue(any(x['content']=='first' for x in seen[-1]))
        self.assertFalse(c.snapshot()['running'])
    def test_error_recovery(self):
        def fail(*args):raise ValueError('teacher offline')
        c=self.create(fail);c.send('hello',self.s)
        for t in c.threads:t.join(2)
        self.assertIn('teacher offline',c.snapshot()['error']);self.assertFalse(c.running)
    def test_validation_and_admission(self):
        c=self.create(lambda *a:None)
        for text in ('',None,'a'*2001):
            with self.assertRaises(ValueError):c.send(text,self.s)
        self.s.paused=True
        with self.assertRaises(ValueError):c.send('hi',self.s)
        self.s.paused=False;self.s.active='trainer'
        with self.assertRaises(ValueError):c.send('hi',self.s)
    def test_persisted_transcript(self):
        c=self.create(lambda model,messages,emit:emit('saved'));c.send('remember',self.s)
        for t in c.threads:t.join(2)
        other=self.create(lambda *a:None)
        self.assertEqual(other.snapshot()['messages'][-1]['content'],'saved')
    def test_busy(self):
        entered=threading.Event();release=threading.Event()
        def slow(model,messages,emit):entered.set();release.wait(2);emit('ok')
        c=self.create(slow);c.send('hello',self.s);entered.wait(1)
        try:
            with self.assertRaises(ValueError):c.send('again',self.s)
        finally:release.set()
if __name__=='__main__':unittest.main()
