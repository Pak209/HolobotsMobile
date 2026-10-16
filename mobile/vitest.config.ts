import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
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
