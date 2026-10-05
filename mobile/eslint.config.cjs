const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
module.exports = defineConfig([expoConfig, { ignores: ['dist/**', 'android/**', 'ios/**'] }, { files: ['*.cjs'], languageOptions: { globals: { __dirname: 'readonly', require: 'readonly', module: 'readonly' } } }]);
