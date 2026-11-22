import { defineConfig } from 'vitest/config';

// Own config so the tests run from this folder, inside or outside the monorepo.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
