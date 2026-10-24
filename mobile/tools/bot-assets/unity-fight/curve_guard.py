"""Fail closed on Unity transform serialization the headless porter cannot reproduce."""
import re

def inspect_curves(text):
    paths = {}; weighted = []; stepped = []; nonidentity_scale = []
    for section, kind in [('m_RotationCurves', 'q'), ('m_PositionCurves', 'p'), ('m_ScaleCurves', 's')]:
        start = text.index('  ' + section + ':'); end = text.index('\n  m_', start + 10)
        for block in text[start:end].split('\n  - curve:')[1:]:
            name = re.search(r'\n    path: (.*)', block).group(1).strip()
            paths.setdefault(name, set()).add(kind)
            if any(int(value) for value in re.findall(r'weightedMode: (\d+)', block)):
                weighted.append([name, kind])
            if any(int(value) for value in re.findall(r'tangentMode: (\d+)', block)) or re.search(r'Slope:.*(?:inf|nan)', block, re.I):
                stepped.append([name, kind])
            if kind == 's':
                values = [float(value) for key in re.findall(r'value: \{([^}]+)\}', block) for value in re.findall(r'[xyz]: ([-0-9.eE]+)', key)]
                if any(abs(value - 1) > 1e-5 for value in values): nonidentity_scale.append(name)
    return dict(paths=paths, weighted=weighted, stepped=stepped, nonidentityScale=nonidentity_scale)

def guard_curves(text, reference_text):
    report = inspect_curves(text); reference = inspect_curves(reference_text)['paths']
    report['missingChannels'] = {path: sorted(channels - report['paths'].get(path, set())) for path, channels in reference.items() if channels - report['paths'].get(path, set())}
    report['paths'] = {path: sorted(channels) for path, channels in report['paths'].items()}
    assert not any(report[key] for key in ('weighted', 'stepped', 'nonidentityScale', 'missingChannels')), report
    return report
