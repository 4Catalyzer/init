const path = require('path');
const fs = require('fs-extra');

const GitUtilities = require('@4c/cli-core/GitUtilities');

module.exports = async function setupNpm(dest, a) {
  const eslint = {
    eslint: '^4.16.0',
    'eslint-config-prettier': '^2.9.0',
    'eslint-plugin-import': '^2.8.0',
    'eslint-plugin-prettier': '^2.5.0',
    'eslint-plugin-jest': '^21.7.0',
  };

  if (a.type === 'web') {
    eslint['eslint-config-4catalyzer-react'] = '^0.4.1';
    eslint['eslint-plugin-react'] = '^7.5.1';
    eslint['eslint-plugin-jsx-a11y'] = '^6.0.3';
  } else {
    eslint['eslint-config-4catalyzer'] = '^0.4.1';
  }

  fs.writeJSON(
    path.join(dest, 'package.json'),
    {
      name: a.name,
      version: '1.0.0',
      main: a.babel ? 'lib/index.js' : 'index.js',
      ...(a.babel && {
        module: 'es/index.js',
      }),

      repository: {
        type: 'git',
        url: GitUtilities.remoteUrl(a.name),
      },
      author: '4Catalyzer',
      license: 'MIT',
      scripts: {
        tdd: 'jest --watch',
        test: 'npm run lint && jest',
        testonly: 'jest',
        ...(a.babel && {
          'build:es':
            'babel src -d es --env-name esm --ignore **/__tests__ --delete-dir-on-start',
          'build:lib':
            'babel src -d lib --ignore **/__tests__ --delete-dir-on-start',
          build: 'npm run build:lib && npm run build:es',
          prepublishOnly: 'yarn run build',
        }),
        lint: [
          'eslint .',
          "prettier --list-different --ignore-path .eslintignore '**/*.{json,css,md}'",
        ].join(' && '),
        format: [
          'eslint . --fix',
          "prettier --write --ignore-path .eslintignore '**/*.{json,css,md}'",
        ].join(' && '),
        precommit: 'lint-staged',
      },
      publishConfig: {
        access: a.isPrivate ? 'restricted' : 'public',
      },
      prettier: {
        printWidth: 79,
        singleQuote: true,
        trailingComma: 'all',
      },
      'lint-staged': {
        '*.js': ['eslint --fix', 'git add'],
        '*.{json,css,md}': [
          'prettier --write --ignore-path .eslintignore',
          'git add',
        ],
      },
      jest: {
        roots: ['<rootDir>/test'],
        testEnvironment: a.type === 'node' ? 'node' : 'jsdom',
      },
      ...(a.semanticRelease && {
        release: {
          extends: ['@4c/semantic-release-config'],
        },
      }),
      devDependencies: {
        ...(a.babel && {
          '@babel/cli': '^7.0.0-beta.39',
          '@babel/core': '^7.0.0-beta.39',
          '@4c/babel-preset-4catalyzer': '^1.0.0',
          'babel-jest': '^22.4.3',
          'babel-core': 'bridge',
        }),
        ...(a.semanticRelease && {
          '@4c/semantic-release-config': '^1.0.2',
        }),
        'babel-eslint': '^8.2.1',
        husky: '^0.14.3',
        'lint-staged': '^7.1.0',
        prettier: '^1.10.2',
        jest: '^22.4.4',
        ...eslint,
      },
    },
    { spaces: 2 },
  );
};