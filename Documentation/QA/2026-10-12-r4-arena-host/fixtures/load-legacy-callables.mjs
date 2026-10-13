// Execute the SHA-pinned baseline callable bodies, not a hand-written behavior model.
// TypeScript transpilation is in memory; imports resolve against the candidate's unchanged
// economy/admin modules. This produces no source, build, or deployment artifact.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../');
const require = createRequire(resolve(repo, 'functions/scripts/test-arena-match-emulator.mjs'));
const ts = require('typescript');
const pins = JSON.parse(readFileSync(resolve(here, 'legacy-source-pins.json'), 'utf8'));

export function loadLegacyCallable(name) {
  const pin = pins.find(row => row.source === `functions/src/arena/${name}.ts`);
  if (!pin) throw new Error(`No source pin for legacy callable ${name}`);
  const source = readFileSync(resolve(here, `legacy-${name}.ts.txt`));
  if (createHash('sha256').update(source).digest('hex') !== pin.sha256) throw new Error('Legacy fixture source pin mismatch');
  const filename = resolve(repo, `functions/lib/arena/legacy-fixture-${name}.js`);
  const compiled = ts.transpileModule(source.toString('utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Legacy fixture transpilation failed');
  const baseline = new Module(filename);
  baseline.filename = filename;
  baseline.paths = Module._nodeModulePaths(dirname(filename));
  baseline._compile(compiled.outputText, filename);
  return baseline.exports[name];
}
