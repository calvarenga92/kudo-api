import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/apoio/banco-de-teste.ts'],
    // Um banco só, compartilhado: as suítes rodam em sequência.
    fileParallelism: false,
  },
});
