// Jest for pure logic (no network, no browser APIs). Runs specs next to their files: `npm test`.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/src/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', moduleResolution: 'node16', verbatimModuleSyntax: false, isolatedModules: true, types: ['jest', 'node', '@webgpu/types'] } }],
  },
};
