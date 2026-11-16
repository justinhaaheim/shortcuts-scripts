const jhaConfig = require('eslint-config-jha-react-node/node');

module.exports = [
  {
    ignores: [
      'tmp/',
      'dist/',
      '**/.claude/worktrees/',
      // Shortcut scripts are function bodies with a top-level `return`, which
      // crashes the shared config's typescript-eslint rules. They are
      // type-checked by scripts/check-scripts.ts instead.
      'src/',
    ],
  },
  ...jhaConfig,
];
