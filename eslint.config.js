// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Android is edge-to-edge: a bare FlatList / ScrollView lets its last rows
    // slide under the system nav bar. Use InsetFlatList / InsetScrollView
    // (components/inset-list), which add the inset. Horizontal lists, inverted
    // chat timelines (the composer owns the inset) and height-capped lists
    // inside a sheet are the exceptions — disable the line and say why.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['FlatList', 'ScrollView', 'SectionList'],
              message:
                'Use InsetFlatList / InsetScrollView from @/components/inset-list (Android nav-bar inset). Horizontal, inverted-chat or height-capped lists in a sheet: `// eslint-disable-next-line no-restricted-imports -- <why>`.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/*'],
  },
]);
