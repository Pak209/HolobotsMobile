"""Run with Python + jsonschema==4.26.0. No Unity/editor or network use."""
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator
ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'Schemas/duel-inputs-1.json').exists())
SCHEMA = json.loads((ROOT / 'Schemas/duel-inputs-1.json').read_text())
V = Draft202012Validator(SCHEMA)
def event(action='strike', **fields):
    e = dict(seq=0, tick=0, actor='ace', action=action)
    if action in ('strike', 'heavy', 'finisher', 'select_target', 'deploy'): e['target']='wolf'
    if action=='move': e.update(x=127,z=-127)
    e.update(fields)
    return e
def log(e=None): return dict(schemaVersion='duel-inputs-1', events=[] if e is None else [e])
class DuelInputsSchemaTests(unittest.TestCase):
    def test_schema_and_examples(self):
        Draft202012Validator.check_schema(SCHEMA)
        for example in SCHEMA['examples']: V.validate(example)
    def test_all_nine_actions(self):
        for action in ('strike','heavy','finisher','select_target','deploy','move','guard_down','guard_up','disengage'):
            with self.subTest(action=action): V.validate(log(event(action)))
    def test_integer_id_and_axis_boundaries(self):
        V.validate(log(event('move',seq=8191,tick=7199,actor='A_0-'*16,x=-127,z=127)))
        for field,value in [('seq',-1),('seq',8192),('tick',7200),('tick',0.5),('tick',True),('actor',''),('actor','a'*65),('actor','ace.bot'),('actor','ace\n'),('x',-128),('z',128),('x',None)]:
            with self.subTest(field=field,value=value): self.assertFalse(V.is_valid(log(event('move',**{field:value}))))
    def test_missing_and_unknown_fields(self):
        for key in ('seq','tick','actor','action','target'):
            e=event();del e[key];self.assertFalse(V.is_valid(log(e)),key)
        for key in ('damage','didWin','hp','sync','seed','rules'):
            e=event();e[key]=1;self.assertFalse(V.is_valid(log(e)),key)
            l=log();l[key]=1;self.assertFalse(V.is_valid(l),key)
        self.assertFalse(V.is_valid({'events':[]}));self.assertFalse(V.is_valid({'schemaVersion':'duel-inputs-1'}))
    def test_action_specific_keys(self):
        for e in [event('defend'),event('wait'),event('move',target='wolf'),event('guard_up',target='wolf'),event('strike',x=0),event(target='bad.id')]:
            self.assertFalse(V.is_valid(log(e)),e)
        e=event('move');del e['z'];self.assertFalse(V.is_valid(log(e)))
    def test_version_and_collection_limits(self):
        self.assertFalse(V.is_valid(dict(schemaVersion='duel-intents-1',events=[])))
        self.assertFalse(V.is_valid(dict(schemaVersion='duel-inputs-1',events={})))
        self.assertFalse(V.is_valid(dict(schemaVersion='duel-inputs-1',events=[None])))
        self.assertFalse(V.is_valid(dict(schemaVersion='duel-inputs-1',events=[event()]*8193)))
    def test_snapshot_and_order_checks_are_not_structural_schema(self):
        # Structurally valid, semantically refused by the sim: seq gap / unknown actor.
        V.validate(log(event(seq=5,actor='unknown')))
        V.validate(dict(schemaVersion='duel-inputs-1',events=[event(tick=2),event(seq=1,tick=1)]))
    def test_available_frozen_vectors(self):
        candidates=[ROOT/'functions/scripts/fixtures/duel-sim/vectors.json', ROOT/'Assets/StreamingAssets/Samples/duel-sim/vectors.json']
        files=[p for p in candidates if p.exists()]
        if not files: self.skipTest('Frozen vectors arrive with the independent Unity twin PR')
        # Standalone schema PR has no dependency on the Unity twin landing first.
        for path in files:
            vectors=json.loads(path.read_text())['vectors'];self.assertEqual(len(vectors),24)
            for v in vectors:
                with self.subTest(vector=v['name']): V.validate(v['log'])
if __name__=='__main__': unittest.main(verbosity=2)
