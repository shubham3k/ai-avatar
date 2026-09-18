import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage", "dist/renderer"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // .cjs files exist specifically *because* this package is "type":
    // "module" but something (Electron's preload sandbox, electron-builder's
    // hook loader) requires plain CommonJS — require() is the correct,
    // intentional choice there, not a lint violation.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
