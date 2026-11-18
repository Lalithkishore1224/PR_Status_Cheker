Fixes #404

`lib/runtime.js` decides whether `.ts` files can be loaded. For `@swc/register`, `@swc-node/register`, `tsm` and `esbuild-register` it only checks `process._preload_modules` (`checkPreloadModules`). Node fills that list only for its own `-r`/`--require` flag. `fastify start -r @swc-node/register` preloads the module with a plain `require()`, so the loader is active but autoload doesn't see it and skips `.ts` files unless `FASTIFY_AUTOLOAD_TYPESCRIPT` is set.

As suggested in the issue, I added a fallback that checks `require.cache`:

- `checkPreloadModules` now falls back to `checkRequireCache`. On first use, `checkRequireCache` collects the package names of everything in `require.cache` into a `Set`, so the cache keys are scanned once per process. Each runtime getter is already cached, so in practice this runs once.
- The package name is taken from the innermost `node_modules` segment and handles both `/` and `\`. That means pnpm's `.pnpm/.../node_modules/@swc-node/register/...` layout and Windows paths work, and it does not depend on `process.cwd()`. That was one of the concerns raised on #406.
- The existing checks still run first and haven't changed. The only new fallback outside `checkPreloadModules` is on `tsx`, because `-r tsx/cjs` has the same problem.
- Matching is on exact package names, so `@swc/core`, `esbuild` or `tsm-utils` being loaded does not enable TypeScript support.

The code runs inside the CJS module itself, so `require.cache` is available even when the app is ESM. That was the other concern raised on #406.

How I verified it: the repro script below simulates the fastify-cli preload with `require()`. I ran it with `--no-experimental-strip-types` so that native type stripping on recent Node doesn't hide the result:

```js
const root = process.argv[2]
require(require.resolve('@swc-node/register', { paths: [root] }))
const runtime = require(root + '/lib/runtime')
console.log('_preload_modules:', JSON.stringify(process._preload_modules))
console.log('runtime.swc:', runtime.swc, 'supportTypeScript:', runtime.supportTypeScript)
```

Before:
```
_preload_modules: []
runtime.swc: false supportTypeScript: false
```

After:
```
_preload_modules: []
runtime.swc: true supportTypeScript: true
```

The new tests in `test/issues/404/test.js` cover these cases:

- a real `require('@swc-node/register')`
- cache entries for `@swc/register`, `tsm`, `esbuild-register` and `tsx`
- a pnpm layout
- a Windows path
- negative cases with similarly named packages

Each case runs in a child process because the runtime checks are cached per process. Coverage is turned off for those children so they don't skew the report. Without the change in `lib/runtime.js`, 5 of the 6 tests fail; the negative case passes either way. `npm test` passes, including lint, tstyche, the loader scripts, jest, vitest and borp, with coverage still at 100%.

Not included: no changes to fastify-cli, and no README change. The `FASTIFY_AUTOLOAD_TYPESCRIPT` override is still documented and still works.
