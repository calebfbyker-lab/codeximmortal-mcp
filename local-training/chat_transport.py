"""Bounded loopback Ollama transport. No tools, retries, pulls or shell."""
import http.client, json, socket, threading, time

HOST='127.0.0.1'
PORT=11434

def diagnostic(model):
    result={'selected':model}
    for name,path in [('installed','/api/tags'),('running','/api/ps'),('version','/api/version')]:
        c=http.client.HTTPConnection(HOST,PORT,timeout=5)
        try:
            c.request('GET',path);r=c.getresponse();raw=r.read(262145)
            if r.status!=200 or len(raw)>262144:raise ValueError('HTTP '+str(r.status)+' or oversized result')
            data=json.loads(raw)
            if name=='version':result[name]=data.get('version')
            else:result[name]=[{k:m[k] for k in ('name','size','size_vram','details') if k in m} for m in data.get('models',[])][:100]
        except Exception as exc:result[name]={'error':type(exc).__name__+': '+str(exc)[:200]}
        finally:c.close()
    return result

def stream(model,messages,emit,stage=lambda value:None,usage=lambda value:None,
           idle=180,total=600,think='default',factory=http.client.HTTPConnection):
    if not 0<idle<=total:raise ValueError('Require 0 < idle <= total')
    c=factory(HOST,PORT,timeout=min(10,total));sock=None;timer=None
    expired=threading.Event();started=time.monotonic();chars=0;records=0
    deadline=started+total
    def deadline_reached():
        return expired.is_set() or time.monotonic()>=deadline
    def expire():
        expired.set()
        if sock is not None:
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
    try:
        stage('connecting');c.connect();sock=c.sock
        timer=threading.Timer(max(.001,deadline-time.monotonic()),expire);timer.daemon=True;timer.start()
        sock.settimeout(min(idle,max(.001,deadline-time.monotonic())))
        body={'model':model,'messages':messages,'stream':True,'keep_alive':'5m',
              'options':{'num_predict':512}}
        if think!='default':body['think']=think=='on'
        stage('waiting for model / response headers')
        c.request('POST','/api/chat',body=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        r=c.getresponse()
        if r.status!=200:
            detail=r.read(2048).decode('utf-8',errors='replace')
            raise ValueError('Ollama HTTP '+str(r.status)+': '+detail[:300])
        stage('waiting for first answer token')
        while True:
            if deadline_reached():raise TimeoutError('Total generation deadline exceeded')
            sock.settimeout(min(idle,max(.001,deadline-time.monotonic())))
            line=r.readline(65537)
            if deadline_reached():raise TimeoutError('Total generation deadline exceeded')
            if not line:raise ValueError('Ollama stream ended without done=true')
            if len(line)>65536:raise ValueError('Oversized stream record')
            if not line.strip():continue
            records+=1
            if records>20000:raise ValueError('Stream record limit exceeded')
            row=json.loads(line)
            if not isinstance(row,dict):raise ValueError('Expected stream object')
            if row.get('error'):raise ValueError('Ollama: '+str(row['error'])[:300])
            message=row.get('message') or {}
            if not isinstance(message,dict):raise ValueError('Invalid message object')
            text=message.get('content','')
            if not isinstance(text,str):raise ValueError('Invalid content')
            if text:
                chars+=len(text)
                if chars>32768:raise ValueError('Response character limit exceeded')
                stage('streaming answer');emit(text)
            elif message.get('thinking'):stage('model thinking; no answer yet')
            if row.get('done'):
                if not chars:raise ValueError('No answer text returned; try --think off if supported, or a different installed chat model')
                usage({k:row[k] for k in ('load_duration','eval_count','eval_duration','done_reason') if k in row})
                stage('completed (token limit)' if row.get('done_reason')=='length' else 'completed')
                return
    except (TimeoutError,socket.timeout) as exc:
        if deadline_reached():raise TimeoutError('Total generation deadline exceeded ('+str(total)+'s)') from exc
        raise TimeoutError('No network progress within '+str(idle)+'s; check Ollama/model loading before retrying') from exc
    except ValueError as exc:
        if deadline_reached():raise TimeoutError('Total generation deadline exceeded ('+str(total)+'s)') from exc
        raise
    except OSError as exc:
        if deadline_reached():raise TimeoutError('Total generation deadline exceeded ('+str(total)+'s)') from exc
        raise
    finally:
        if timer:timer.cancel()
        c.close()
