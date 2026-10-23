import pathlib,unittest
from curve_guard import guard_curves

def clip(scale='1', weighted='0', tangent='0', omit=''):
    result=[]
    for section,value in [('Rotation','{x: 0, y: 0, z: 0, w: 1}'),('Position','{x: 0, y: 0, z: 0}'),('Scale','{x: '+scale+', y: '+scale+', z: '+scale+'}')]:
        result.append('  m_'+section+'Curves:')
        if section != omit: result.append('\n'.join(['  - curve:','        time: 0','        value: '+value,'        inSlope: {x: 0, y: 0, z: 0}','        tangentMode: '+tangent,'        weightedMode: '+weighted,'    path: Armature/Hips']))
    return '\n'.join(result)+'\n  m_FloatCurves: []\n'

class Guard(unittest.TestCase):
    def test_complete_identity_unweighted(self):self.assertEqual(guard_curves(clip(),clip())['missingChannels'],{})
    def test_weighted_refuses(self):
        with self.assertRaises(AssertionError):guard_curves(clip(weighted='1'),clip())
    def test_stepped_refuses(self):
        with self.assertRaises(AssertionError):guard_curves(clip(tangent='103'),clip())
    def test_nonidentity_scale_refuses(self):
        with self.assertRaises(AssertionError):guard_curves(clip(scale='.01'),clip())
    def test_missing_channel_never_borrows_animated_reference(self):
        with self.assertRaises(AssertionError):guard_curves(clip(omit='Position'),clip())
if __name__=='__main__':unittest.main()
