const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", "backup-data/**", "config-data/**", "swagger.json"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      // Unused catch bindings and leading-underscore args are deliberate.
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // Sanitisers strip control characters on purpose.
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Newer recommended rules that only flag style in existing code; revisit separately.
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "no-useless-catch": "off",
    },
  },
  {
    // An unused timer handle here is replaced by the timers refactor; don't touch the file in this change.
    files: ["classes/task-manager.js"],
    rules: { "no-unused-vars": "off" },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module", globals: { ...globals.node } },
  },
];
