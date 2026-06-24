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
    // SettingsTab + FieldPickerModal are DOM-heavy UI exercised by the dev
    // harness and manual QA in Obsidian; including them in coverage targets
    // would push us toward brittle DOM-snapshot tests for low value.
    "!src/settings/SettingsTab.ts",
    "!src/settings/FieldPickerModal.ts",
  ],
  coverageThreshold: {
    global: {
      // Reasonable bar given the renderer and auth flows are heavily tested
      // and the omitted UI shells are exercised by manual / dev harness QA.
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
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
