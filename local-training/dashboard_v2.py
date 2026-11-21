"""Experimental gated launcher; no automatic training or promotion."""
import argparse
import contextlib
import hmac
import http.server
import json
import os
import secrets
import threading
import time
import lab

ACTIONS = {'generate': lab.generate, 'filter': lab.filter_data,
           'export': lab.export_data, 'plan': lab.make_plan}

@contextlib.contextmanager
def workspace(c):
    path = c['home'] / 'companion.lock'
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError('Workspace locked. Verify all jobs have stopped before manually recovering a stale companion.lock.')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump({'pid': os.getpid(), 'started': time.time()}, f)
        if (c['home'] / 'training.lock').exists():
            raise ValueError('Legacy training lock present; stop and inspect.')
        yield
    finally:
        path.unlink(missing_ok=True)

def prerequisite(c, action):
    h = c['home']
    if action == 'generate':
        if (h / 'raw.jsonl').exists():
            raise ValueError('raw.jsonl already exists; generation will not overwrite it.')
        return
    required = {'filter': ['raw.jsonl'], 'export': ['raw.jsonl', 'accepted.jsonl'],
                'plan': ['datasets/statistics.json']}
    for name in required[action]:
        path = h / name
        if not path.is_file():
            raise ValueError('Missing prerequisite: ' + name)
        if name.endswith('.jsonl'):
            values = lab.rows(path)
            if not values or any(not isinstance(v, dict) for v in values):
                raise ValueError('Empty or invalid dataset: ' + name)
            for row in values:
                if not all(k in row for k in ('task_id', 'split', 'messages', 'tasks_hash')):
                    raise ValueError('Missing trace fields in ' + name)
                if not isinstance(row['messages'], list) or not row['messages']:
                    raise ValueError('Invalid messages in ' + name)
        else:
            values = lab.load(path)
            for key in ('sft_train', 'sft_validation', 'dpo_train', 'dpo_validation'):
                if type(values.get(key)) is not int or values[key] < c['minimum_examples']:
                    raise ValueError('Insufficient or invalid dataset count: ' + key)

def run(c, action):
    with workspace(c):
        prerequisite(c, action)
        return ACTIONS[action](c)

def make_server(c, port=8766, token=None):
    token = token or secrets.token_urlsafe(32)
    guard = threading.Lock()
    state = {'running': False, 'action': None, 'started': None, 'last': None}
    workers = []
    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)
        def log_message(self, *args):
            pass
        def reply(self, code, body, html=False):
            data = body.encode('utf-8') if html else json.dumps(body).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'text/html; charset=utf-8' if html else 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Connection', 'close')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.close_connection = True
            self.wfile.write(data)
        def host(self):
            return '127.0.0.1:%d' % self.server.server_port
        def do_GET(self):
            if self.headers.get('Host') != self.host():
                return self.reply(403, {'error': 'Invalid host'})
            if self.path != '/':
                return self.reply(404, {'error': 'Not found'})
            return self.reply(200, PAGE, True)
        def do_POST(self):
            if self.headers.get('Host') != self.host() or self.headers.get('Origin') != 'http://' + self.host():
                return self.reply(403, {'error': 'Invalid host or origin'})
            if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), ('Bearer ' + token).encode()):
                return self.reply(403, {'error': 'Invalid token'})
            if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
                return self.reply(400, {'error': 'Body not accepted'})
            action = self.path.removeprefix('/api/')
            if action == 'status':
                with guard:
                    result = dict(state)
                return self.reply(200, result)
            if action not in ACTIONS:
                return self.reply(404, {'error': 'Action not allowed'})
            with guard:
                if state['running']:
                    return self.reply(409, {'error': 'Job running'})
                state.update(running=True, action=action, started=time.time())
                def work():
                    try:
                        result = {'action': action, 'ok': True, 'result': run(c, action)}
                    except Exception as exc:
                        result = {'action': action, 'ok': False, 'error': str(exc)}
                    with guard:
                        state.update(running=False, action=None, last=result)
                thread = threading.Thread(target=work, daemon=False)
                workers.append(thread)
                thread.start()
            return self.reply(202, {'queued': action})
    return http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler), token, workers

PAGE = """<!doctype html><html lang="en"><meta charset="utf-8"><title>Local Training</title>
<style>body{font:16px system-ui;background:#151923;color:#eee;max-width:900px;margin:30px auto;padding:16px}button,input{padding:10px;margin:5px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>Local training companion</h1><p>Experimental / UNCERTIFIED. No training or promotion endpoint.</p>
<p>Use this launcher only. Old lab.py commands bypass the workspace lock. Generation has no checkpoints; do not force-close it.</p>
<input id="token" type="password" autocomplete="off" placeholder="Terminal token"><button id="connect">Connect</button><span id="connection"></span>
<div id="buttons"></div><p id="message"></p><pre id="status"></pre>
<script>
const el=id=>document.getElementById(id);let connected=false;const buttons=[];
async function api(a){const r=await fetch('/api/'+a,{method:'POST',headers:{Authorization:'Bearer '+el('token').value},signal:AbortSignal.timeout(10000)});const b=await r.json();if(!r.ok)throw Error(b.error||r.status);return b;}
for(const a of ['generate','filter','export','plan']){const b=document.createElement('button');b.textContent=a;b.disabled=true;b.onclick=async()=>{try{await api(a);el('message').textContent='Queued '+a;}catch(e){el('message').textContent=e.message;}};buttons.push(b);el('buttons').append(b);}
el('connect').onclick=()=>{connected=true;};
async function poll(){try{if(connected){const s=await api('status');el('connection').textContent='Connected';el('status').textContent=JSON.stringify(s,null,2);for(const b of buttons)b.disabled=s.running;}}catch(e){el('connection').textContent=e.message;for(const b of buttons)b.disabled=true;}finally{setTimeout(poll,2000);}}poll();
</script></html>"""

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['dashboard'] + list(ACTIONS))
    args = parser.parse_args()
    c = lab.config()
    if args.action != 'dashboard':
        print(json.dumps(run(c, args.action), indent=2))
        return
    server, token, workers = make_server(c)
    print('Open http://127.0.0.1:8766; token (private): ' + token, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('Closing dashboard. Waiting for accepted jobs; do not force-close.', flush=True)
    finally:
        server.server_close()
        for worker in workers:
            worker.join()

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as exc:
        raise SystemExit(str(exc))
