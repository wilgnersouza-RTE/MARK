/**
 * Testes em TypeScript via ts-jest.
 *
 * O tsconfig.json do projeto exclui os *.test.ts do build e restringe os
 * tipos globais a "node"; aqui os tipos do Jest entram só para os testes.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // Antes de qualquer import: os testes nunca falam com Supabase ou Redis reais.
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
          esModuleInterop: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          types: ['node', 'jest'],
        },
      },
    ],
  },
};
