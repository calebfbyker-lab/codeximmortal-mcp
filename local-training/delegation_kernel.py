"""Durable deterministic fixture queue. No model, shell, network or repository access."""
import hashlib
import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone


def stamp():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


class Kernel:
    def __init__(self, path, clock=time.time):
        self.clock = clock
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS tasks(
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, mid TEXT NOT NULL,
          digest TEXT NOT NULL, payload TEXT NOT NULL, context TEXT NOT NULL,
          state TEXT NOT NULL, deadline REAL NOT NULL, updated TEXT NOT NULL,
          artifact TEXT, UNIQUE(owner,mid));
        CREATE TABLE IF NOT EXISTS events(
          seq INTEGER PRIMARY KEY, task TEXT NOT NULL, stage TEXT NOT NULL,
          time TEXT NOT NULL);
        """)
        with self.db:
            rows=self.db.execute("SELECT id FROM tasks WHERE state='WORKING'").fetchall()
            for (tid,) in rows:
                self._state(tid, 'FAILED', {'reason':'interrupted; not replayed'})

    def _state(self, tid, state, artifact=None):
        self.db.execute('UPDATE tasks SET state=?,updated=?,artifact=? WHERE id=?',
                        (state,stamp(),json.dumps(artifact) if artifact is not None else None,tid))
        self.db.execute('INSERT INTO events(task,stage,time) VALUES(?,?,?)',(tid,state,stamp()))

    def submit(self, owner, message):
        if not isinstance(message,dict) or set(message)-{'messageId','role','parts'}:
            raise ValueError('New fixture messages only; no task continuation')
        mid=message.get('messageId')
        if not isinstance(mid,str) or not 1<=len(mid)<=128 or message.get('role')!='ROLE_USER':
            raise ValueError('Invalid message identity or role')
        parts=message.get('parts')
        if not isinstance(parts,list) or len(parts)!=1 or not isinstance(parts[0],dict):
            raise ValueError('One structured data part required')
        part=parts[0]
        if set(part)!={'data','mediaType'} or part['mediaType']!='application/json':
            raise ValueError('application/json data part required')
        data=part['data']
        if not isinstance(data,dict) or set(data)!={'operation','objective','contextBundleId'}:
            raise ValueError('Invalid application payload')
        if data['operation']!='fixture.review' or data['contextBundleId']!='fixture.console.v1':
            raise ValueError('Only the synthetic fixture route is enabled')
        if not isinstance(data['objective'],str) or not 1<=len(data['objective'].strip())<=1000:
            raise ValueError('Objective must contain 1-1000 characters')
        payload=json.dumps(message,sort_keys=True,separators=(',',':'),ensure_ascii=True)
        digest=hashlib.sha256(payload.encode()).hexdigest()
        with self.lock,self.db:
            prior=self.db.execute('SELECT id,digest FROM tasks WHERE owner=? AND mid=?',(owner,mid)).fetchone()
            if prior:
                if prior[1]!=digest: raise ValueError('Message ID reused with different content')
                return self.get(owner,prior[0])
            if self.db.execute('SELECT COUNT(*) FROM tasks').fetchone()[0]>=1000:
                raise ValueError('Pilot retention quota reached; operator archival required')
            count=self.db.execute("SELECT COUNT(*) FROM tasks WHERE state IN ('SUBMITTED','WORKING')").fetchone()[0]
            if count>=8: raise ValueError('Queue limit reached')
            tid=str(uuid.uuid4());context=str(uuid.uuid4())
            self.db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)',
                (tid,owner,mid,digest,payload,context,'SUBMITTED',self.clock()+60,stamp(),None))
            self.db.execute('INSERT INTO events(task,stage,time) VALUES(?,?,?)',(tid,'SUBMITTED',stamp()))
            return self.get(owner,tid)

    def get(self, owner, tid):
        with self.lock:
            row=self.db.execute('SELECT id,context,state,updated,artifact FROM tasks WHERE id=? AND owner=?',(tid,owner)).fetchone()
            if row is None: raise LookupError('Task unavailable')
            result={'id':row[0],'contextId':row[1],
                    'status':{'state':'TASK_STATE_'+row[2],'timestamp':row[3]}}
            if row[4] is not None:
                result['artifacts']=[{'artifactId':'fixture-result','name':'Synthetic fixture evidence',
                  'parts':[{'mediaType':'application/json','data':json.loads(row[4])}]}]
            return result

    def step(self):
        with self.lock,self.db:
            row=self.db.execute("SELECT id,deadline FROM tasks WHERE state='SUBMITTED' ORDER BY rowid LIMIT 1").fetchone()
            if row is None: return False
            tid,deadline=row
            if self.clock()>=deadline:
                self._state(tid,'FAILED',{'reason':'deadline before execution'});return True
            self._state(tid,'WORKING')
        with self.lock,self.db:
            for stage in ('fixture.inspector','fixture.planner','fixture.reviewer'):
                self.db.execute('INSERT INTO events(task,stage,time) VALUES(?,?,?)',(tid,stage,stamp()))
            self._state(tid,'COMPLETED',{'synthetic':True,'modelCalls':0,'children':0,
                'stages':['fixture.inspector','fixture.planner','fixture.reviewer'],
                'finding':'Deterministic fixture completed; no repository was inspected.',
                'applied':False,'trainingPerformed':False})
            return True

    def close(self):
        with self.lock: self.db.close()
