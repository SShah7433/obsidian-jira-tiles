/**
 * Jest configuration for the Jira Tiles plugin.
 *
 * - jsdom environment so DOM-touching code (tile renderer, formatters) can run.
 * - ts-jest transforms TypeScript on the fly.
 * - The Obsidian module is mocked at the path level since Obsidian APIs are
 *   unavailable in a Node test runner. Tests import the same path the plugin
 *   uses ("obsidian") and receive the lightweight mock from tests/mocks/obsidian.ts.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/tests", "<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^obsidian$": "<rootDir>/tests/mocks/obsidian.ts",
  },
  setupFiles: ["<rootDir>/tests/setup.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/main.ts", // Plugin entry — exercised via integration in Obsidian.
  ],
  coverageThreshold: {
    global: {
      // Reasonable starting bar; raise as the suite grows.
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // Tests run as CommonJS via ts-jest.
          module: "commonjs",
          esModuleInterop: true,
        },
      },
    ],
  },
};
