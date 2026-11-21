"""Reliable chat launcher; reuses existing console authentication and job controls."""
import argparse, json, time
import chat_console as base
import chat_transport as transport

class ReliableChat(base.Chat):
    def __init__(self,home,model,idle=180,total=600,think='default'):
        self.idle=idle;self.total=total;self.think=think
        self.phase='idle';self.since=None;self.preview='';self.usage={}
        super().__init__(home,model,self.infer_reliable)
    def infer_reliable(self,model,messages,emit):
        def stage(value):
            with self.lock:self.phase=value
        def usage(value):
            with self.lock:self.usage=value
        def output(value):
            with self.lock:self.preview+=value
            emit(value)
        # Failed turns are stored for audit but never resend a run of unanswered prompts.
        clean=[]
        for item in messages:
            item=dict(item);item['content']=item['content'][-12000:]
            if clean and item['role']==clean[-1]['role']=='user':clean[-1]=item
            else:clean.append(item)
        while len(clean)>3 and sum(len(x['content']) for x in clean)>24000:
            del clean[1:3]
        transport.stream(model,clean,output,stage,usage,self.idle,self.total,self.think)
    def send(self,text,supervisor):
        with self.lock:
            if self.running:raise ValueError('Chat is busy; do not queue duplicate requests')
            self.phase='queued';self.since=time.monotonic();self.preview='';self.usage={}
            self.threads=[t for t in self.threads if t.is_alive()]
            return super().send(text,supervisor)
    def snapshot(self):
        with self.lock:
            state=super().snapshot()
            state.update(phase='error' if self.error else self.phase,
                         elapsed=round(time.monotonic()-self.since,1) if self.running and self.since else None,
                         failed_partial=self.preview if self.error else '',usage=self.usage)
            return state

PANEL=r"""<section id="chat-panel"><h2>Local assistant chat · reliable transport</h2>
<p>One assistant, no autonomous swarm, commands or repository writes. History is stored outside the repository. Do not enter secrets. Use the console token above.</p>
<p id="chat-state" role="status">Connect above to begin.</p><pre id="chat-transcript" aria-live="polite"></pre>
<label for="chat-input">Message</label><textarea id="chat-input" maxlength="2000" rows="3" style="width:95%;padding:12px"></textarea><br><button id="chat-send">Send message</button></section>
<script>
(()=>{const el=id=>document.getElementById(id);let enabled=false,sending=false;
async function req(route,body={}){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);try{const r=await fetch('/api/chat/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+el('token').value},body:JSON.stringify(body),signal:ctl.signal});const d=await r.json();if(!r.ok)throw Error(d.error||r.status);return d;}finally{clearTimeout(timer);}}
el('connect').addEventListener('click',()=>{enabled=true;});
el('chat-send').onclick=async()=>{if(sending)return;sending=true;el('chat-send').disabled=true;try{await req('send',{message:el('chat-input').value});el('chat-input').value='';enabled=true;}catch(e){el('chat-state').textContent='Send failed: '+e.message;}finally{sending=false;}};
async function poll(){try{if(enabled){const s=await req('status');el('chat-state').textContent=s.model+' · '+s.phase+(s.elapsed!==null?' · '+s.elapsed+'s':'')+(s.error?' · '+s.error:'');el('chat-send').disabled=s.running||sending;el('chat-transcript').textContent=s.messages.map(m=>m.role.toUpperCase()+': '+m.content).join('\n\n')+(s.partial?'\n\nASSISTANT (streaming): '+s.partial:'')+(s.failed_partial?'\n\nINCOMPLETE RESPONSE (not added to history): '+s.failed_partial:'');}}catch(e){el('chat-state').textContent='Connection lost: '+e.message;el('chat-send').disabled=true;}finally{setTimeout(poll,1000);}}poll();
})();
</script>"""

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--model',required=True)
    p.add_argument('--port',type=int,default=8767);p.add_argument('--idle-timeout',type=int,default=180)
    p.add_argument('--total-timeout',type=int,default=600);p.add_argument('--think',choices=('default','off','on'),default='default')
    p.add_argument('--diagnose',action='store_true');a=p.parse_args()
    if not 1<=a.port<=65535:p.error('Invalid port')
    if not 10<=a.idle_timeout<=a.total_timeout<=1800:p.error('Require 10 <= idle timeout <= total timeout <= 1800')
    if a.diagnose:
        print(json.dumps(transport.diagnostic(a.model),indent=2));return
    import lab
    from dashboard_v2 import workspace
    c=lab.config();base.PANEL=PANEL
    with workspace(c):
        supervisor=base.console.Supervisor(c['home']);chat=ReliableChat(c['home'],a.model,a.idle_timeout,a.total_timeout,a.think)
        try:
            server,token=base.make_server(supervisor,chat,a.port)
            print('Open http://127.0.0.1:'+str(a.port)+' ; private token: '+token,flush=True)
            print('Reliable chat: '+a.model+'; idle '+str(a.idle_timeout)+'s; total '+str(a.total_timeout)+'s; thinking '+a.think,flush=True)
            try:server.serve_forever()
            except KeyboardInterrupt:print('Waiting for bounded inference and managed work.',flush=True)
            finally:server.server_close()
        finally:chat.close();supervisor.close()

if __name__=='__main__':main()
