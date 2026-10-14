import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "artifacts/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "packages/database/generated/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        fetch: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
      },
    },
  },
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
);
