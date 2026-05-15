import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        caches: 'readonly',
        crypto: 'readonly',
        indexedDB: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        HTMLElement: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
        TextEncoder: 'readonly',
        globalThis: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        requestIdleCallback: 'readonly',
        cancelIdleCallback: 'readonly',
        FormData: 'readonly',
        confirm: 'readonly',
        alert: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],
    },
  },
  {
    // Server (Node, CommonJS) overrides
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        global: 'readonly',
      },
    },
    rules: {
      // Server may log freely (operational logging).
      'no-console': 'off',
    },
  },
  {
    // Vitest config is ESM (uses `import` / `export default`).
    files: ['server/vitest.config.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    // Vitest test files use globals (`describe`, `it`, `expect`, `beforeEach`, …)
    // because `test.globals: true` is set in server/vitest.config.js.
    files: ['server/tests/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'server/node_modules/**'],
  },
];
