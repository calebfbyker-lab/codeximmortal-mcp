"""Core/HTTP tests use an explicit codec double; generated-type tests require the pinned SDK."""
import concurrent.futures
import http.client
import http.server
import importlib.util
import json
import pathlib
import sys
import tempfile
import threading
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from delegation_kernel import Kernel
from a2a_fixture import Codec, attach, dispatch


def message(mid='m1'):
    return {'messageId':mid,'role':'ROLE_USER','parts':[{'mediaType':'application/json',
      'data':{'operation':'fixture.review','objective':'Test fixture',
              'contextBundleId':'fixture.console.v1'}}]}


def request(method='SendMessage',params=None):
    if params is None: params={'message':message(),'configuration':{'returnImmediately':True}}
    return {'jsonrpc':'2.0','id':'r1','method':method,'params':params}


class Double:
    def convert(self,name,data): return data
    def card(self,port): return {'name':'explicit-test-double'}


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.tmp.name)/'tasks.db'
        self.k=Kernel(self.path)
    def tearDown(self): self.k.close();self.tmp.cleanup()
    def test_fixture_roundtrip(self):
        t=self.k.submit('alice',message());self.assertEqual(t['status']['state'],'TASK_STATE_SUBMITTED')
        self.k.step();t=self.k.get('alice',t['id'])
        self.assertEqual(t['status']['state'],'TASK_STATE_COMPLETED')
        self.assertTrue(t['artifacts'][0]['parts'][0]['data']['synthetic'])
    def test_no_cross_owner_read(self):
        t=self.k.submit('alice',message())
        with self.assertRaises(LookupError): self.k.get('bob',t['id'])
    def test_duplicate_and_conflicting_message(self):
        a=self.k.submit('alice',message());b=self.k.submit('alice',message())
        self.assertEqual(a['id'],b['id'])
        m=message();m['parts'][0]['data']['objective']='changed'
        with self.assertRaises(ValueError): self.k.submit('alice',m)
    def test_concurrent_dedup(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results=list(pool.map(lambda _:self.k.submit('alice',message())['id'],range(12)))
        self.assertEqual(len(set(results)),1)
    def test_pending_and_receipt_survive_restart(self):
        t=self.k.submit('alice',message());self.k.close();self.k=Kernel(self.path)
        self.assertEqual(self.k.submit('alice',message())['id'],t['id'])
        self.k.step();self.assertEqual(self.k.get('alice',t['id'])['status']['state'],'TASK_STATE_COMPLETED')
    def test_interrupted_work_is_failed_not_replayed(self):
        t=self.k.submit('alice',message())
        with self.k.lock,self.k.db: self.k._state(t['id'],'WORKING')
        self.k.close();self.k=Kernel(self.path)
        self.assertEqual(self.k.get('alice',t['id'])['status']['state'],'TASK_STATE_FAILED')
        self.assertFalse(self.k.step())
    def test_queue_limit(self):
        for n in range(8): self.k.submit('alice',message(str(n)))
        with self.assertRaises(ValueError): self.k.submit('alice',message('overflow'))
    def test_expired_task(self):
        t=self.k.submit('alice',message());self.k.clock=lambda:10**12;self.k.step()
        self.assertEqual(self.k.get('alice',t['id'])['status']['state'],'TASK_STATE_FAILED')
    def test_unapproved_route_and_path_rejected(self):
        for key,value in [('operation','shell.run'),('contextBundleId','../../secrets')]:
            m=message();m['parts'][0]['data'][key]=value
            with self.assertRaises(ValueError): self.k.submit('alice',m)
    def test_unknown_permission_fields_rejected(self):
        m=message();m['parts'][0]['data']['shell']=True
        with self.assertRaises(ValueError): self.k.submit('alice',m)
    def test_rpc_envelope_and_method(self):
        self.assertEqual(dispatch(self.k,Double(),'alice',[])['error']['code'],-32600)
        self.assertEqual(dispatch(self.k,Double(),'alice',request('CancelTask',{}))['error']['code'],-32601)


class HttpTests(unittest.TestCase):
    def setUp(self):
        CoreTests.setUp(self)
        class Parent(http.server.BaseHTTPRequestHandler):
            def setup(self): super().setup();self.connection.settimeout(2)
            def host(self): return '127.0.0.1:'+str(self.server.server_port)
            def log_message(self,*args): pass
            def reply(self,status,body):
                b=json.dumps(body).encode();self.send_response(status)
                self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)))
                self.end_headers();self.wfile.write(b)
        self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Parent)
        attach(self.server,self.k,Double(),'console-fixture','a2a-fixture')
        self.thread=threading.Thread(target=self.server.serve_forever);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();CoreTests.tearDown(self)
    def call(self,token='a2a-fixture',version='1.0',origin=None,path='/a2a',body=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        headers={'Content-Type':'application/json','Authorization':'Bearer '+token,'A2A-Version':version}
        if origin is not None: headers['Origin']=origin
        try:
            c.request('POST',path,json.dumps(body or request()),headers)
            r=c.getresponse();return r.status,json.loads(r.read())
        finally: c.close()
    def test_http_auth_and_version(self):
        self.assertEqual(self.call(token='wrong')[0],401)
        self.assertEqual(self.call(token='console-fixture')[0],401)
        self.assertEqual(self.call(version='0.3')[0],400)
        self.assertEqual(self.call(origin='http://evil.invalid')[0],403)
    def test_http_send_get(self):
        status,r=self.call();self.assertEqual(status,200);tid=r['result']['task']['id']
        self.k.step()
        status,r=self.call(body=request('GetTask',{'id':tid}))
        self.assertEqual(r['result']['status']['state'],'TASK_STATE_COMPLETED')
    def test_dashboard_origin_required(self):
        self.assertEqual(self.call(token='console-fixture',path='/api/delegation')[0],403)


class GeneratedTypesTests(unittest.TestCase):
    def test_sdk_card_and_task_roundtrip(self):
        try: codec=Codec()
        except (ImportError,RuntimeError): self.skipTest('Pinned A2A SDK is not available')
        card=codec.card(8767)
        self.assertEqual(card['supportedInterfaces'][0]['protocolVersion'],'1.0')
        with tempfile.TemporaryDirectory() as tmp:
            k=Kernel(pathlib.Path(tmp)/'tasks.db')
            try:
                response=dispatch(k,codec,'alice',request())
                self.assertNotIn('error',response)
                tid=response['result']['task']['id'];k.step()
                response=dispatch(k,codec,'alice',request('GetTask',{'id':tid}))
                self.assertEqual(response['result']['status']['state'],'TASK_STATE_COMPLETED')
            finally: k.close()


if __name__=='__main__': unittest.main()
