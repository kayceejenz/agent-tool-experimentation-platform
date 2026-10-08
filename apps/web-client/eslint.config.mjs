import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["@/components/**", "**/components/**"], message: "Shared hooks and transport/domain modules must not depend on feature UI. Keep feature controllers with their components." }],
      }],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/lib/**/server", "@/lib/**/routes", "@/lib/http/project-route", "next/headers", "server-only"], message: "UI and browser hooks use client transport; server authentication and route policy stay on the server." },
        ],
      }],
    },
  },
  {
    files: ["src/hooks/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [
      { group: ["@/components/**", "**/components/**"], message: "Shared hooks must not depend on feature UI." },
      { group: ["@/lib/**/server", "@/lib/**/routes", "@/lib/http/project-route", "next/headers", "server-only"], message: "Shared browser hooks use client transport." },
    ] }] },
  },
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
]);
