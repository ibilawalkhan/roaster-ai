import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Supabase Edge Functions are Deno, not Next.js: remote URL imports and the
    // `Deno` global are unresolvable here. They are type-checked and run by the
    // Supabase/Deno toolchain instead (see supabase/functions/*/README.md).
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
