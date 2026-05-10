/** @type {import('jest').Config} */
module.exports = {
  // Don't use jest-expo preset as it loads react-native/jest/setup.js which uses ESM
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@ants/.*|zustand|@react-native/.*)',
  ],
  moduleNameMapper: {
    '^@ants/ui$': '<rootDir>/../../packages/ui/src/index.ts',
    '^@ants/ui/(.*)$': '<rootDir>/../../packages/ui/src/$1',
    // Mock react-native to avoid ESM issues
    '^react-native$': '<rootDir>/src/test/react-native-mock.js',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/test/**/*',
    '!src/index.ts',
  ],
  coverageReporters: ['text', 'json', 'html'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
};
