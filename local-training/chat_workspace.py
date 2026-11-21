"""Opt-in workspace UI over the existing reliable transport. No new tools or writes."""
import errno
from functools import wraps


def disconnect_safe(reply):
    @wraps(reply)
    def wrapped(self, *args, **kwargs):
        try:
            return reply(self, *args, **kwargs)
        except OSError as exc:
            codes = {errno.EPIPE, errno.ECONNRESET, errno.ECONNABORTED}
            if exc.errno not in codes and getattr(exc, 'winerror', None) not in {10053, 10054}:
                raise
            self.close_connection = True
            return None
    return wrapped


def install_guard(console):
    original = console.make_server
    def make_server(*args, **kwargs):
        server, token = original(*args, **kwargs)
        parent = server.RequestHandlerClass
        class Handler(parent):
            reply = disconnect_safe(parent.reply)
        server.RequestHandlerClass = Handler
        return server, token
    console.make_server = make_server


PANEL = r"""<style>
#chat-panel{background:#101c2c;border:1px solid #30425a;border-radius:16px;padding:22px;font-family:system-ui,sans-serif;color:#e6edf6}
#chat-panel *{box-sizing:border-box}#chat-panel h2{margin:0;font-size:23px}#chat-panel .sub{color:#acbbce;font-size:14px;line-height:1.5}
#chat-panel .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}#chat-panel .badge{border:1px solid #415978;border-radius:20px;padding:6px 12px;font-size:13px}
#chat-panel .grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:18px}#chat-panel aside{border-left:1px solid #30425a;padding-left:18px;font-size:14px;overflow-wrap:anywhere}
#chat-panel #ws-messages{height:48vh;min-height:220px;overflow:auto;padding:8px;background:#0b1421;border-radius:12px}
#chat-panel article{margin:10px 0;padding:14px;border:1px solid #2b3d55;border-radius:12px;background:#152337}
#chat-panel article[data-role=user]{border-left:3px solid #7ab8ff}#chat-panel article[data-role=error]{border-left:3px solid #eab478}
#chat-panel article header{font-size:12px;color:#b4c7de;margin-bottom:8px}#chat-panel .body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;font-size:15px}
#chat-panel textarea{width:100%;resize:vertical;min-height:76px;max-height:220px;background:#0b1421;color:#eff5ff;border:1px solid #526b8c;border-radius:10px;padding:12px;font:inherit}
#chat-panel button{padding:10px 16px;border-radius:9px;border:1px solid #557496;background:#233c5b;color:#fff;cursor:pointer}#chat-panel button:disabled{opacity:.55;cursor:not-allowed}
#chat-panel :focus-visible{outline:3px solid #9acbff;outline-offset:3px}#chat-panel summary{cursor:pointer}#chat-panel pre{white-space:pre-wrap;font-size:12px}#chat-panel label{display:block;margin:12px 0 6px}
@media(max-width:1050px){#chat-panel .grid{grid-template-columns:1fr}#chat-panel aside{border-left:0;border-top:1px solid #30425a;padding:12px 0}#chat-panel #ws-messages{height:42vh}}
</style>
<section id="chat-panel" aria-label="Local chat workspace">
<h2>Local Workspace</h2><p class="sub">Reliable transport · Discuss mode · One assistant, not autonomous swarm execution. No model tools or repository writes. Connect using the console token above; never put secrets in chat.</p>
<div class="bar"><span class="badge" id="ws-model">Model: unavailable</span><span class="badge" id="ws-phase">Disconnected</span><span class="badge" id="ws-clock">No active request</span></div>
<p id="ws-notice" role="status">Connect above to load status. Old errors remain in saved history.</p>
<div class="grid"><div><div id="ws-messages" role="log" aria-label="Conversation" aria-live="off"></div>
<label for="ws-input">Message</label><textarea id="ws-input" maxlength="2000" rows="3" placeholder="Ask a question about supplied evidence"></textarea>
<div class="bar"><button id="ws-send" disabled>Send message</button><span class="sub">Ctrl+Enter to send · 2,000-character limit</span></div></div>
<aside><h3>Context &amp; evidence</h3><p id="ws-evidence">Snapshot unavailable.</p><p class="sub">Agent states are supervisor-reported, not independently verified. Model residency, RAM and GPU telemetry are unavailable here.</p>
<details><summary>Diagnostics</summary><pre id="ws-details">No status received.</pre></details><p class="sub">Execution controls below retain their existing approval rules. No cancellation or automatic retry is added.</p></aside></div></section>
<script>
(()=>{'use strict';const el=id=>document.getElementById(id);let enabled=false,sending=false,busy=false,healthy=false,last='',ticks=0;
async function request(path,body={}){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+el('token').value},body:JSON.stringify(body),signal:ctl.signal});const data=await r.json();if(!r.ok)throw Error(data.error||String(r.status));return data;}finally{clearTimeout(timer);}}
function button(){el('ws-send').disabled=!healthy||sending||busy;}
function card(role,text,label){const a=document.createElement('article');a.dataset.role=role;const h=document.createElement('header');h.textContent=label;const b=document.createElement('div');b.className='body';const parts=String(text).split(/(\*\*[^*\n]+\*\*)/g);for(const p of parts){if(p.startsWith('**')&&p.endsWith('**')&&p.length>4){const strong=document.createElement('strong');strong.textContent=p.slice(2,-2);b.append(strong);}else b.append(document.createTextNode(p));}a.append(h,b);return a;}
function render(s){const key=JSON.stringify([s.messages,s.partial,s.failed_partial]);if(key===last)return;last=key;const box=el('ws-messages'),follow=box.scrollHeight-box.scrollTop-box.clientHeight<60;const nodes=(s.messages||[]).map(m=>card(m.role,m.content,m.role==='error'?'Saved error · timestamp unavailable':m.role+' · '+(m.model||'model unavailable')+' · saved history'));if(s.partial)nodes.push(card('assistant',s.partial,'Assistant · streaming'));if(s.failed_partial)nodes.push(card('error',s.failed_partial,'Incomplete response · not committed to assistant history'));box.replaceChildren(...nodes);if(follow)box.scrollTop=box.scrollHeight;}
el('connect').addEventListener('click',()=>{enabled=true;healthy=false;button();});
el('ws-send').onclick=async()=>{const text=el('ws-input').value;if(sending||busy||!healthy||!text.trim())return;sending=true;button();try{await request('/api/chat/send',{message:text});el('ws-input').value='';busy=true;el('ws-notice').textContent='Request accepted; waiting for status.';}catch(e){healthy=false;el('ws-notice').textContent='Send outcome uncertain: '+e.message+'. Check status before resending; no automatic retry.';}finally{sending=false;button();}};
el('ws-input').addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();el('ws-send').click();}});
async function evidence(){try{const s=await request('/api/status',{after:0});const agents=Array.isArray(s.agents)?s.agents:null;el('ws-evidence').textContent='Snapshot received '+new Date().toLocaleTimeString()+' · Repository: '+(s.repo||'unavailable')+' · Agents: '+(agents?agents.length:'unknown')+' · Managed job: '+(s.active||'none reported')+' · '+(agents?agents.map(a=>a.id+': '+a.state).join('; '):'Agent data unavailable')+' · Repair: '+(s.repair||'unknown');}catch(e){el('ws-evidence').textContent='Snapshot stale or unavailable: '+e.message;}}
async function poll(){try{if(enabled){const s=await request('/api/chat/status');healthy=true;busy=!!s.running;el('ws-model').textContent='Selected: '+s.model;el('ws-phase').textContent=s.phase||'unknown';el('ws-clock').textContent=s.running&&s.elapsed!==null?s.elapsed+'s elapsed':'No active request';el('ws-notice').textContent=s.error?'Latest chat error: '+s.error:'Status received '+new Date().toLocaleTimeString()+' · Saved messages may predate this session.';el('ws-details').textContent=JSON.stringify({phase:s.phase,error:s.error,usage:s.usage},null,2);render(s);if(ticks++%5===0)await evidence();}}catch(e){healthy=false;el('ws-phase').textContent='Connection unavailable';el('ws-notice').textContent='Status unavailable: '+e.message+' · Existing messages retained; no automatic resubmission.';el('ws-evidence').textContent='Snapshot stale; connection has not been verified.';}finally{button();setTimeout(poll,2000);}}poll();
})();
</script>"""


def main():
    import chat_reliable as reliable
    install_guard(reliable.base.console)
    reliable.PANEL = PANEL
    reliable.main()


if __name__ == '__main__':
    main()
