// eslint.config.js or eslint.config.mjs
import eslint from '@eslint/js';
import node from 'eslint-plugin-node';
import importPlugin from 'eslint-plugin-import';
import promise from 'eslint-plugin-promise';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      '**/dist/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    plugins: {
      node,
      import: importPlugin,
      promise,
    },
    settings: {
      'import/resolver': {
        node: true,
      },
    },
    rules: {
      // ESLint Core Rules
      'no-console': 'off',
      'no-unused-vars': ['error', { 
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_',
      }],
      'curly': ['error', 'all'],
      'eqeqeq': ['error', 'always'],
      'no-floating-decimal': 'error',
      'no-multi-spaces': 'error',
      'no-return-await': 'error',
      'require-await': 'error',
      'no-use-before-define': ['error', { 
        'functions': false,
        'classes': true,
        'variables': true,
      }],

      // ES6+ Rules
      'arrow-spacing': ['error', { 'before': true, 'after': true }],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',

      // Node Plugin Rules
      'node/no-unsupported-features/es-syntax': 'off',
      'node/no-missing-import': 'off',

      // Import Plugin Rules
      'import/first': 'error',
      'import/no-duplicates': 'error',
      'import/order': ['error', {
        'groups': [
          'builtin',
          'external',
          'internal',
          ['parent', 'sibling'],
          'index',
        ],
        'newlines-between': 'always',
      }],

      // Promise Plugin Rules
      'promise/always-return': 'error',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/catch-or-return': 'error',
      'promise/no-native': 'off',
      'promise/no-callback-in-promise': 'warn',
      'promise/no-promise-in-callback': 'warn',
      'promise/no-nesting': 'warn',
    },
  },
  eslint.configs.recommended,
];
