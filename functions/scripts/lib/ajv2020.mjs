// Ajv (draft 2020-12) for the fight-host-1 contract tests: the functions devDependency (CI), else the rules-tests copy
// (a local checkout run with NODE_PATH=../rules-tests/node_modules).
import { createRequire } from 'node:module';
let Ajv2020;
try { Ajv2020 = createRequire(import.meta.url)('ajv/dist/2020'); }
catch { Ajv2020 = createRequire(new URL('../../../rules-tests/package.json', import.meta.url))('ajv/dist/2020'); }
export const ajv2020 = () => new Ajv2020({ strict: false });
