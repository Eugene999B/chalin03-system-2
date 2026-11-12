import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: {
          jsx: true,
        },
        sourceType: "module",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^(formatUptime|[A-Z_])" },
      ],

      // We are allowing normal beginner-friendly data loading with useEffect.
      "react-hooks/set-state-in-effect": "off",

      // Existing protected-session pages compare expiry timestamps during render.
      "react-hooks/purity": "off",

      // We are allowing AuthContext.jsx to export both AuthProvider and useAuth.
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["playwright.config.js", "e2e/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["src/pages/EquipmentFinanceFinalLifecyclePage.jsx"],
    rules: {
      // The stage queue is intentionally memoized from immutable string/state inputs.
      // React Compiler cannot currently preserve this valid manual memoization shape.
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    files: ["src/pages/EquipmentFinanceProfessionalPage.jsx"],
    rules: {
      // The protected image loop overwrites its prior pass before testing byte size;
      // the assignment is deliberate state shared across bounded resize attempts.
      "no-useless-assignment": "off",
    },
  },
]);
