module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/bin/**',
    '!src/__tests__/**',
    '!src/templates/**',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageDirectory: 'coverage',
};
