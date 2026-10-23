// eslint-config-next 16 ships native flat configs, so they are spread directly.
// The previous FlatCompat wrapper threw "Converting circular structure to JSON"
// because the config is no longer eslintrc-shaped.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      ".next/**",
      "lib/generated/**",
      "node_modules/**",
      "ops-local/**",
      "public/**",
    ],
  },
  {
    // Reads the OAuth redirect result out of window.location on mount, which is
    // exactly the external system an effect is for. A useState initializer
    // cannot replace it: this is a client component that Next still renders on
    // the server, so touching window during render reintroduces a hydration
    // mismatch. The cost is one extra render when returning from a redirect.
    files: ["components/dashboard/user-integrations-panel.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    // These modules are server-only and render nothing. Their `use*` functions
    // are plain boolean predicates (which storage backend is active, whether
    // cookies should be secure), not React hooks — but react-hooks matches on
    // the `use` prefix alone and cannot tell the difference. Renaming them
    // would churn every call site to satisfy a rule that does not apply here.
    files: ["services/store.ts", "lib/auth-config.ts", "proxy.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];

export default eslintConfig;
