import { defineConfig, type Plugin } from 'vitest/config';
import path from 'node:path';

import { BRANCH_HOST_DIR, PIN_SRC, resolveHostSrc } from './test-fixtures/hostPin.mjs';

// The parity tests import the deployed host through test-fixtures/host-pin (HOST_PIN.json has the sha).
// HOLOCITY_HOST_ROOT=<functions dir> serves those imports from that checkout instead; hostPin.test.ts
// then fails, listing every file that differs from the pin. Nothing may load the branch's own functions/
// copy, however it is reached, unless HOLOCITY_HOST_ROOT points there on purpose (the known-bad control).
const hostSrc = resolveHostSrc();

function refuseBranchHost(allowed: string): Plugin {
  return {
    name: 'holocity-no-branch-host',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (!file.startsWith(BRANCH_HOST_DIR + path.sep) || file.startsWith(allowed + path.sep)) return null;
      throw new Error(`${file} is the branch's own functions/ copy; parity tests must import the pinned deployed host (test-fixtures/host-pin).`);
    },
  };
}

function redirectHostPin(target: string): Plugin {
  return {
    name: 'holocity-host-root',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || !resolved.id.startsWith(PIN_SRC + path.sep)) return null;
      return path.join(target, path.relative(PIN_SRC, resolved.id));
    },
  };
}

export default defineConfig({
  plugins: [refuseBranchHost(hostSrc), ...(hostSrc === PIN_SRC ? [] : [redirectHostPin(hostSrc)])],
  resolve: {
    alias: {
      // Resolve the native-only Firebase persistence entry before the test mock.
      '@firebase/auth/dist/rn/index': path.resolve(__dirname, './node_modules/@firebase/auth/dist/rn/index.js'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
