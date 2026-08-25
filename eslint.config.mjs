import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const typedFiles = ["**/*.{ts,tsx,cts,mts}"];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.ts",
      "target/**",
      "packages/contracts/src/protocol.generated.ts",
      ".agent/**",
      ".agents/**",
      ".amp/**",
      ".claude/**",
      ".codex/**",
      ".cursor/**",
      ".devin/**",
      ".firecrawl/**",
      ".grok/**",
      ".opencode/**",
      ".trellis/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typedFiles,
  })),
  {
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        project: [
          "./apps/desktop/tsconfig.electron.json",
          "./apps/desktop/tsconfig.renderer.json",
          "./packages/contracts/tsconfig.json",
          "./packages/ui/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["**/*.cts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
