"""Opt-in fixture A2A adapter integrated into chat_workspace. UNCERTIFIED subset."""
import hmac
import importlib.metadata
import json
import secrets
import threading
from pathlib import Path
from delegation_kernel import Kernel


class Codec:
    def __init__(self):
        if importlib.metadata.version('a2a-sdk')!='1.3.1':
            raise RuntimeError('Install the pinned requirements-a2a-fixture.txt in a dedicated environment')
        from a2a import types
        from google.protobuf.json_format import ParseDict, MessageToDict
        from google.protobuf.json_format import ParseError
        self.types,self.parse,self.dump,self.parse_error=types,ParseDict,MessageToDict,ParseError

    def convert(self,name,data):
        try: value=self.parse(data,getattr(self.types,name)(),ignore_unknown_fields=False)
        except self.parse_error as exc: raise ValueError('Invalid '+name+' schema') from exc
        return self.dump(value,preserving_proto_field_name=False)

    def card(self,port):
        return self.convert('AgentCard',{
            'name':'CodexImmortal Fixture Gateway',
            'description':'Synthetic fixture only. No model calls, repository access, training or spawning.',
            'version':'0.1.0',
            'supportedInterfaces':[{'url':'http://127.0.0.1:'+str(port)+'/a2a',
              'protocolBinding':'JSONRPC','protocolVersion':'1.0'}],
            'capabilities':{'streaming':False,'pushNotifications':False,'extendedAgentCard':False},
            'defaultInputModes':['application/json'],'defaultOutputModes':['application/json'],
            'securitySchemes':{'localBearer':{'httpAuthSecurityScheme':{'scheme':'Bearer'}}},
            'securityRequirements':[{'schemes':{'localBearer':{'list':[]}}}],
            'skills':[{'id':'fixture.review','name':'Review synthetic fixture',
              'description':'Validate durable routing using three deterministic fixture stages.',
              'tags':['fixture','read-only'],'inputModes':['application/json'],
              'outputModes':['application/json']}]})


def dispatch(kernel,codec,owner,body):
    rid=body.get('id') if isinstance(body,dict) else None
    def error(code,text): return {'jsonrpc':'2.0','id':rid,'error':{'code':code,'message':text}}
    if not isinstance(body,dict) or set(body)!={'jsonrpc','id','method','params'}:
        return error(-32600,'Request object with id required; batching and notifications disabled')
    if body['jsonrpc']!='2.0' or isinstance(rid,bool) or not isinstance(rid,(str,int)):
        return error(-32600,'Invalid request')
    params=body['params']
    if not isinstance(params,dict): return error(-32602,'Invalid params')
    method=body['method']
    try:
        if method=='SendMessage':
            codec.convert('SendMessageRequest',params)
            if set(params)!={'message','configuration'} or params['configuration']!={'returnImmediately':True}:
                raise ValueError('Fixture requires only message and returnImmediately=true configuration')
            task=kernel.submit(owner,params['message'])
            result=codec.convert('SendMessageResponse',{'task':task})
        elif method=='GetTask':
            codec.convert('GetTaskRequest',params)
            if set(params)!={'id'} or not isinstance(params['id'],str): raise ValueError('Task id required')
            result=codec.convert('Task',kernel.get(owner,params['id']))
        else: return error(-32601,'Method not implemented in fixture profile')
        return {'jsonrpc':'2.0','id':rid,'result':result}
    except LookupError: return error(-32001,'Task unavailable')
    except ValueError as exc: return error(-32602,str(exc)[:180])


PANEL=r"""<section id="delegation-panel"><h2>Delegation fixture</h2>
<p>UNCERTIFIED · A2A 1.0 target · MCP 2026-07-28 adapter disabled. Synthetic worker only; no Llama delegation, repository access or training.</p>
<button id="fixture-submit">Run synthetic fixture</button> <button id="fixture-refresh">Refresh task</button>
<pre id="fixture-state" role="status">No task submitted. Use the console token above.</pre></section>
<script>(()=>{const el=id=>document.getElementById(id);let task=null,pending=null;
async function rpc(method,params){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);try{const r=await fetch('/api/delegation',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+el('token').value},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method,params}),signal:ctl.signal});const d=await r.json();if(!r.ok)throw Error('HTTP '+r.status);if(d.error)throw Error(d.error.message);return d.result;}finally{clearTimeout(timer);}}
el('fixture-submit').onclick=async()=>{el('fixture-submit').disabled=true;try{if(!pending)pending={messageId:crypto.randomUUID(),role:'ROLE_USER',parts:[{mediaType:'application/json',data:{operation:'fixture.review',objective:'Validate synthetic routing',contextBundleId:'fixture.console.v1'}}]};const r=await rpc('SendMessage',{message:pending,configuration:{returnImmediately:true}});task=r.task.id;pending=null;el('fixture-state').textContent=JSON.stringify(r,null,2);}catch(e){el('fixture-state').textContent='Submission uncertain or rejected: '+e.message+'. The same message ID is retained for a manual retry.';}finally{el('fixture-submit').disabled=false;}};
el('fixture-refresh').onclick=async()=>{if(!task)return;try{el('fixture-state').textContent=JSON.stringify(await rpc('GetTask',{id:task}),null,2);}catch(e){el('fixture-state').textContent='Refresh failed: '+e.message;}};})();</script>"""


def attach(server,kernel,codec,console_token,a2a_token):
    parent=server.RequestHandlerClass
    card=codec.card(server.server_port)
    class Handler(parent):
        def do_GET(self):
            if self.path=='/.well-known/agent-card.json':
                if self.headers.get('Host')!=self.host(): return self.reply(403,{'error':'Host rejected'})
                return self.reply(200,card)
            return super().do_GET()

        def do_POST(self):
            if self.path not in ('/a2a','/api/delegation'): return super().do_POST()
            if self.headers.get('Host')!=self.host(): return self.reply(403,{'error':'Host rejected'})
            origin=self.headers.get('Origin')
            if origin and origin!='http://'+self.host(): return self.reply(403,{'error':'Origin rejected'})
            dashboard=self.path=='/api/delegation'
            if dashboard and origin!='http://'+self.host(): return self.reply(403,{'error':'Origin required'})
            secret=console_token if dashboard else a2a_token
            if not hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+secret).encode()):
                return self.reply(401,{'error':'Unauthorized'})
            if not dashboard and self.headers.get('A2A-Version')!='1.0':
                return self.reply(400,{'error':'A2A-Version: 1.0 required'})
            if self.headers.get_content_type()!='application/json' or self.headers.get('Transfer-Encoding'):
                return self.reply(400,{'error':'Invalid framing or content type'})
            try:
                n=int(self.headers.get('Content-Length','0'))
                if not 0<n<=8192: raise ValueError('Body must contain 1-8192 bytes')
                body=json.loads(self.rfile.read(n),parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
            except (ValueError,UnicodeError): return self.reply(400,{'error':'Invalid JSON body'})
            try: result=dispatch(kernel,codec,'local-owner',body)
            except Exception: return self.reply(500,{'error':'Internal fixture error; inspect operator diagnostics'})
            return self.reply(200,result)
    server.RequestHandlerClass=Handler
    return server


def main():
    try: codec=Codec()
    except (ImportError,importlib.metadata.PackageNotFoundError,RuntimeError) as exc:
        raise SystemExit('A2A fixture dependency unavailable: '+str(exc))
    import chat_workspace as workspace
    import chat_reliable as reliable
    workspace.install_guard(reliable.base.console)
    original=reliable.base.make_server
    def make_server(supervisor,chat,port=8767,token=None):
        kernel=Kernel(supervisor.home/'delegation-fixture.sqlite3')
        stop=threading.Event()
        def work():
            while not stop.wait(.2):
                try: kernel.step()
                except Exception: stop.set()
        try:
            server,console_token=original(supervisor,chat,port,token)
            a2a_token=secrets.token_urlsafe(32)
            attach(server,kernel,codec,console_token,a2a_token)
            worker=threading.Thread(target=work,daemon=False);worker.start()
            close=server.server_close
            def server_close():
                try: close()
                finally: stop.set();worker.join();kernel.close()
            server.server_close=server_close
            print('Private A2A fixture token (separate from console): '+a2a_token,flush=True)
            return server,console_token
        except Exception:
            kernel.close();raise
    reliable.base.make_server=make_server
    reliable.PANEL=workspace.PANEL+PANEL
    reliable.main()


if __name__=='__main__': main()
