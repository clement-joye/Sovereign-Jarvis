import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "**/dist/**",
      "node_modules",
      "coverage",
      ".pnpm-store",
      ".agents/**",
      "docs/generated",
      "tests/integration/**",
      "vitest.config.ts",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
      "**/*.d.ts",
      "**/*.d.mts",
      "profiles/**",
      // Immutable plugin payloads are validated and hashed as runtime
      // resources; their executable entrypoints retain the profile runtime's
      // separate SDK/toolchain rather than the application TS project.
      "plugins/**/resources/**"
    ]
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ],
      "@typescript-eslint/require-await": "off"
    }
  },
  {
    files: ["**/*.test.ts", "**/*.contract.test.ts"],
    rules: {
      // Vitest's asymmetric matchers are typed as `any`; keeping this one
      // rule off prevents false positives while the other unsafe rules apply.
      "@typescript-eslint/no-unsafe-assignment": "off"
    }
  },
  {
    files: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.contract.test.ts"],
    rules: {
      // Production-code guardrails. Thresholds are deliberately above the
      // ESLint defaults so that cohesive route dispatchers stay together
      // while still catching accidental complexity creep. Per the CQ-21 note,
      // a small well-named helper must reduce cognitive load before splitting
      // a function solely to satisfy a number.
      complexity: ["warn", 15],
      "max-lines-per-function": [
        "warn",
        { max: 130, skipBlankLines: true, skipComments: true, IIFEs: true }
      ],
      "max-depth": ["warn", 4],
      "max-lines": ["warn", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-params": ["warn", 4],
      "max-nested-callbacks": ["warn", 4]
    }
  }
);
