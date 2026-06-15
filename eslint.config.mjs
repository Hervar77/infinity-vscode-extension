import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
	{
		files: [ 'src/**/*.ts' ],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: 'module'
		},
		plugins: {
			'@typescript-eslint': tseslintPlugin
		},
		rules: {
			'@typescript-eslint/naming-convention': 'warn',
			'curly': 'warn',
			'eqeqeq': 'warn',
			'no-throw-literal': 'warn',
			'semi': 'off'
		}
	}
];
