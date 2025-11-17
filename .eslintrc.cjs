module.exports = {
	rules: {
		'@typescript-eslint/consistent-type-imports': 'error',
		'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
		'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
		'@typescript-eslint/explicit-function-return-type': 'off',
		'@typescript-eslint/no-explicit-any': 'warn',
		'prefer-const': 'error',
		'no-var': 'error',
	},
	parser: '@typescript-eslint/parser',
	plugins: ['@typescript-eslint'],
	extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
	ignorePatterns: [
		'dist/**',
		'node_modules/**',
		'src/server/next/.next/**',
		'src/server/next/out/**',
	],
	env: {
		node: true,
		es2022: true,
	},
	parserOptions: {
		sourceType: 'module',
		ecmaVersion: 'latest',
		project: false,
	},
};

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: false
  },
  env: {
    es2022: true,
    node: true
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off'
  },
  ignorePatterns: ['dist', 'node_modules']
};



