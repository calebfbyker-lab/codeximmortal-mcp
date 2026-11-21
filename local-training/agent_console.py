"""Owner-operated local process console. No autonomous patch application."""
import argparse, collections, hashlib, hmac, http.server, json, os, pathlib
import re, secrets, sqlite3, subprocess, sys, threading, time
import psutil

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent
ROLES = {'observer': 'active', 'verifier': 'active', 'generator': 'learning',
         'filter': 'learning', 'export': 'learning', 'planner': 'active', 'trainer': 'training'}
LABELS = {'observer':'Repository observer', 'verifier':'Diff verifier',
          'generator':'Synthetic data', 'filter':'Trajectory verifier',
          'export':'Dataset exporter', 'planner':'Training planner', 'trainer':'LoRA trainer'}

def child(action):
    import lab
    c = lab.config()
    if action in ('observer', 'verifier'):
        command = ['git', '--no-optional-locks', '-C', str(REPO)]
        command += ['status', '--short', '--branch'] if action == 'observer' else ['diff', '--check']
        return subprocess.call(command, shell=False)
    methods = {'generator':lab.generate, 'filter':lab.filter_data,
               'export':lab.export_data, 'planner':lab.make_plan}
    result = lab.train(c, sys.stdin.readline().strip()) if action == 'trainer' else methods[action](c)
    print(json.dumps(result, indent=2), flush=True)
    return 0

class Supervisor:
    def __init__(self, home, script=None):
        self.home = pathlib.Path(home)
        self.script = str(script or pathlib.Path(__file__).resolve())
        self.lock = threading.RLock()
        self.paused = False
        self.proc = None
        self.active = None
        self.started = None
        self.closing = False
        self.threads = []
        self.metrics = {}
        self.cards = {a:{'id':a, 'name':LABELS[a], 'state':'idle', 'pid':None,
                         'exit_code':None, 'cpu_percent':None, 'rss_bytes':None} for a in ROLES}
        self.db = sqlite3.connect(str(self.home/'console.sqlite3'), check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, time REAL, agent TEXT, kind TEXT, text TEXT)')
        self.db.commit()
        self.event('console', 'started', 'New session. External processes are not adopted.')

    def event(self, agent, kind, text):
        with self.lock:
            self.db.execute('INSERT INTO events(time,agent,kind,text) VALUES(?,?,?,?)',
                            (time.time(),agent,kind,str(text)[:4096]))
            self.db.execute('DELETE FROM events WHERE id <= (SELECT COALESCE(MAX(id),0)-5000 FROM events)')
            self.db.commit()

    def start(self, agent, approval=''):
        with self.lock:
            if agent not in ROLES: raise ValueError('Unknown agent; arbitrary commands are forbidden')
            if self.closing or self.paused: raise ValueError('New work paused')
            if self.active: raise ValueError('A job is running; restart is idle-only and never interrupts training')
            if agent == 'trainer':
                import lab
                plan = lab.load(self.home/'plan.json')
                if not re.fullmatch(r'[0-9a-f]{64}', approval) or not hmac.compare_digest(approval,lab.digest(plan)):
                    raise ValueError('Review the plan and enter its exact SHA-256')
            env = {k:v for k,v in os.environ.items() if k.upper() in
                   {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA',
                    'APPDATA','VIRTUAL_ENV','CONDA_PREFIX','CUDA_PATH','CUDA_VISIBLE_DEVICES','LD_LIBRARY_PATH'}}
            env.update(PYTHONUNBUFFERED='1', CODEX_TRAIN_HOME=str(self.home),
                       HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
            p = subprocess.Popen([sys.executable,'-u',self.script,'--worker',agent],
                    cwd=str(REPO),env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,shell=False)
            self.proc, self.active, self.started = p, agent, time.time()
            self.cards[agent].update(state=ROLES[agent],pid=p.pid,exit_code=None)
            self.event(agent,'started','PID '+str(p.pid))
            p.stdin.write((approval+'\n').encode()); p.stdin.close()
            t=threading.Thread(target=self.collect,args=(agent,p),daemon=False)
            self.threads.append(t); t.start()

    def collect(self, agent, p):
        try:
            while True:
                chunk=p.stdout.read1(2048)
                if not chunk: break
                self.event(agent,'output',chunk.decode('utf-8',errors='replace'))
            rc=p.wait()
            with self.lock:
                self.cards[agent].update(state='idle' if rc==0 else 'error',exit_code=rc,
                                         pid=None,cpu_percent=None,rss_bytes=None)
                self.event(agent,'completed' if rc==0 else 'failed','Exit code '+str(rc))
                self.active=None; self.proc=None; self.metrics={}
        finally:
            p.stdout.close()

    def snapshot(self, after=0):
        with self.lock:
            if self.proc and self.proc.poll() is None:
                try:
                    parent=psutil.Process(self.proc.pid)
                    cpu=0.; rss=0; seen=set()
                    for item in [parent]+parent.children(recursive=True):
                        try:
                            key=(item.pid,item.create_time()); seen.add(key)
                            if key not in self.metrics:
                                item.cpu_percent(None); self.metrics[key]=item
                            else: cpu+=self.metrics[key].cpu_percent(None)
                            rss+=item.memory_info().rss
                        except (psutil.NoSuchProcess,psutil.AccessDenied): pass
                    self.metrics={k:v for k,v in self.metrics.items() if k in seen}
                    self.cards[self.active].update(cpu_percent=round(cpu,1),rss_bytes=rss)
                except (psutil.NoSuchProcess,psutil.AccessDenied):
                    self.cards[self.active].update(cpu_percent=None,rss_bytes=None)
            rows=self.db.execute('SELECT id,time,agent,kind,text FROM events WHERE id>? ORDER BY id LIMIT 250',(after,)).fetchall()
            return {'repo':str(REPO),'paused':self.paused,'active':self.active,'started':self.started,
                    'agents':list(self.cards.values()),'events':[dict(zip(('id','time','agent','kind','text'),r)) for r in rows],
                    'repair':'Unavailable: no sandboxed patch executor is installed',
                    'metrics_note':'Process tree CPU: 100% = one logical CPU; summed RSS may double-count shared pages. First sample is warm-up. Shared Ollama/GPU usage is not attributed.'}

    def close(self):
        with self.lock: self.closing=True; self.paused=True
        for t in self.threads: t.join()
        self.db.close()

def make_server(supervisor, port=8767, token=None):
    token=token or secrets.token_urlsafe(32)
    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            super().setup(); self.connection.settimeout(10)
        def log_message(self,*a): pass
        def reply(self,code,body,html=False):
            data=body.encode() if html else json.dumps(body).encode()
            self.send_response(code)
            for k,v in {'Content-Type':'text/html; charset=utf-8' if html else 'application/json',
                        'Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff',
                        'Connection':'close','Content-Length':str(len(data))}.items(): self.send_header(k,v)
            self.end_headers(); self.close_connection=True; self.wfile.write(data)
        def host(self): return '127.0.0.1:'+str(self.server.server_port)
        def do_GET(self):
            if self.headers.get('Host')!=self.host(): return self.reply(403,{'error':'Host rejected'})
            if self.path!='/': return self.reply(404,{'error':'Not found'})
            self.reply(200,(ROOT/'agent-console.html').read_text(encoding='utf-8'),True)
        def do_POST(self):
            if self.headers.get('Host')!=self.host() or self.headers.get('Origin')!='http://'+self.host():
                return self.reply(403,{'error':'Origin rejected'})
            if not hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode()):
                return self.reply(403,{'error':'Invalid token'})
            try:
                n=int(self.headers.get('Content-Length','0'))
                if self.headers.get('Transfer-Encoding') or not 0<=n<=4096: raise ValueError('Invalid body length')
                data=json.loads(self.rfile.read(n) or b'{}')
                if not isinstance(data,dict): raise ValueError('Expected object')
                if self.path=='/api/status':
                    return self.reply(200,supervisor.snapshot(max(0,int(data.get('after',0)))))
                if self.path=='/api/plan':
                    import lab
                    plan=lab.load(supervisor.home/'plan.json')
                    return self.reply(200,{'plan':plan,'sha256':lab.digest(plan)})
                if self.path=='/api/pause':
                    with supervisor.lock: supervisor.paused=True
                    supervisor.event('console','paused','New launches paused; current job continues')
                elif self.path=='/api/resume':
                    with supervisor.lock: supervisor.paused=False
                    supervisor.event('console','resumed','New launches allowed')
                elif self.path in ('/api/start','/api/restart'):
                    supervisor.start(data.get('agent'),data.get('approval',''))
                else: return self.reply(404,{'error':'Not allowed'})
                return self.reply(200,{'ok':True})
            except (ValueError,TypeError,KeyError,OSError) as e: return self.reply(400,{'error':str(e)})
    return http.server.ThreadingHTTPServer(('127.0.0.1',port),Handler),token

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--worker',choices=list(ROLES)); p.add_argument('--port',type=int,default=8767)
    a=p.parse_args()
    if a.worker: return child(a.worker)
    if not 1<=a.port<=65535: p.error('Invalid port')
    import lab
    from dashboard_v2 import workspace
    c=lab.config()
    with workspace(c):
        s=Supervisor(c['home'])
        try:
            server,token=make_server(s,a.port)
            print('Open http://127.0.0.1:'+str(a.port)+' ; private token: '+token,flush=True)
            print('No sandboxed repair executor. Pause is admission-only. Shutdown waits for active work.',flush=True)
            try: server.serve_forever()
            except KeyboardInterrupt: print('Waiting for active work; do not force-close.',flush=True)
            finally: server.server_close()
        finally: s.close()
    return 0

if __name__=='__main__': sys.exit(main())
