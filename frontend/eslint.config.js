import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
export default ts.config({ignores:['dist','node_modules']},js.configs.recommended,...ts.configs.recommended,
  {files:['src/**/*.{ts,tsx}'],plugins:{'react-hooks':hooks},rules:{...hooks.configs.recommended.rules,'@typescript-eslint/no-explicit-any':'error'}},
  // browser-check scripts run in Node but evaluate code inside pages, so both sets of globals apply
  {files:['e2e/**/*.mjs'],languageOptions:{globals:{...globals.node,...globals.browser,axe:'readonly'}}});
