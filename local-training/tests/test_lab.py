import importlib.util, pathlib, tempfile, unittest, json
spec=importlib.util.spec_from_file_location("lab",pathlib.Path(__file__).resolve().parents[1]/"lab.py")
lab=importlib.util.module_from_spec(spec); spec.loader.exec_module(lab)
class Tests(unittest.TestCase):
 def test_verifier(self):
  self.assertEqual(lab.verify([{"content":'{"answer":3}'}],3),1)
  for content in ['{"answer":true}','{"answer":4}','{"answer":3,"execute":"x"}','oops']:
   self.assertEqual(lab.verify([{"content":content}],3),0)
 def test_hash(self):
  self.assertEqual(lab.digest({"a":1,"b":2}),lab.digest({"b":2,"a":1}))
 def test_split_ids(self):
  tasks=lab.load(lab.ROOT/"tasks.json")
  self.assertEqual(len(tasks),len({t["id"] for t in tasks}))
  self.assertEqual({t["split"] for t in tasks},{"train","validation","test"})
 def test_export_disjoint(self):
  with tempfile.TemporaryDirectory() as tmp:
   c={"home":pathlib.Path(tmp)}
   messages=[{"role":"system","content":"s"},{"role":"user","content":"q"},{"role":"assistant","content":'{"answer":10}'}]
   good={"task_id":"train-0","split":"train","messages":messages}
   bad={**good,"messages":messages[:-1]+[{"role":"assistant","content":'{"answer":0}'}]}
   lab.jsonl(c["home"]/"accepted.jsonl",[good,{**good,"split":"test","task_id":"test-0"}])
   lab.jsonl(c["home"]/"raw.jsonl",[bad])
   result=lab.export_data(c)
   self.assertEqual(result["sft_train"],1)
   self.assertEqual(result["sft_validation"],0)
 def test_missing_approval(self):
  with tempfile.TemporaryDirectory() as tmp:
   c={"home":pathlib.Path(tmp)};lab.dump(c["home"]/"plan.json",{"commands":[]})
   with self.assertRaises(ValueError): lab.train(c,None)
 def test_offline_pipeline_and_plan(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as tmp:
   home=pathlib.Path(tmp); model=home/"model";model.mkdir();lab.dump(model/"config.json",{"model_type":"fixture"})
   c={"home":home,"teacher_model":"mock","candidates_per_task":2,"reward_threshold":1.0,"minimum_examples":8,
      "student_model_path":str(model),"license_reviewed":True,"template":"fixture","max_steps":2,"training_timeout_seconds":5}
   answers={turn["user"]:turn["expected"] for t in lab.load(lab.ROOT/"tasks.json") for turn in t["turns"]}
   counts={}
   def fake(c,messages):
    q=messages[-1]["content"];counts[q]=counts.get(q,0)+1
    import re
    if len(messages)==2:
     nums=[int(x) for x in re.findall(r"\d+",q)]; answer=nums[0]+nums[1]
    else:
     answer=json.loads(messages[-2]["content"])["answer"]-int(re.search(r"\d+",q).group())
    return json.dumps({"answer":answer+(1 if len(messages)==4 and counts[q]%2==0 else 0)})
   with patch.object(lab,"infer",side_effect=fake):
    self.assertEqual(lab.generate(c)["generated"],72)
   self.assertEqual(lab.filter_data(c)["accepted"],36)
   self.assertEqual(lab.export_data(c)["dpo_train"],12)
   plan=lab.make_plan(c)
   self.assertEqual(len(plan["approval_sha256"]),64)
   self.assertEqual(plan["plan"]["promotion"],"manual_only")
   with self.assertRaises(ValueError):lab.generate(c)
if __name__=="__main__": unittest.main()
