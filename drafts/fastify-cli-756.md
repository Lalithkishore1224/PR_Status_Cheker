Fixes #756

The `test` script that `generate.js` writes for `fastify generate --lang=ts` (the CommonJS TypeScript template) wraps the glob in quotes:

```
c8 node --test -r ts-node/register "test/**/*.ts"
```

Because of the quotes the shell never expands the pattern, so `node --test` gets the literal string `test/**/*.ts`. Glob support in the test runner only landed in Node.js 21, so on Node.js 20 (still in the CI matrix) and older the runner looks for a file with that exact name and fails with `Could not find '.../test/**/*.ts'`, which is what the issue reports. On 22+ it happens to work because Node expands the pattern itself.

The JavaScript templates and the ESM TypeScript template already pass the glob unquoted (`test/**/*.test.js`, `test/**/*.ts`), so this just drops the quotes in `typescriptTemplate.scripts.test` to match them. With the shell expanding the pattern, the script works the same way on every Node version. A side effect is that `test/helper.ts` is no longer handed to the runner as a test file on Node 22+ (it showed up as an extra "test" before).

`test/generate-typescript.test.js` now expects the unquoted script and also asserts that the glob is not quoted.

How I verified:

`node --test test/generate-typescript.test.js` fails without the change to `generate.js` (strictEqual on the script) and passes with it. Full `npm test` passes (lint, template suites, 231 pass / 1 skipped in the CLI suite, tstyche).

Generated a project with the CLI and checked what `node` actually receives from the script's shell:

```
--- argv node receives, before (quoted):
[ 'test/**/*.ts' ]
--- after (unquoted):
[
  'test/plugins/support.test.ts',
  'test/routes/example.test.ts',
  'test/routes/root.test.ts'
]
--- npm test in the generated project (Node 26), after:
✔ support works standalone
✔ example is loaded
✔ default root route
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

Before the change the same project on Node 26 reported `tests 4` because `test/helper.ts` was also run as a test file. I did not have a Node 20 binary available locally, so the literal-pattern failure on 20 is based on the argv shown above plus the Node changelog (glob support for `node --test` added in v21), not a run on 20.

Left out on purpose:

- With `sh`, `**` behaves like `*`, so the expanded pattern only matches one directory level (`test/*/*.ts`). That is the same as the other templates today and covers the generated layout; I did not try to change that.
- Separately, the generated TS project currently fails `npm run build:ts` with TypeScript 6 (`TS5011`, `rootDir` must be set) and ts-node can't find Node types in tests. That's unrelated to this issue; for the run above I pinned `typescript@5` in the scratch project.
