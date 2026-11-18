Fixes #306

`callbackUriParams` is only accepted as a static object (`index.js`, the option check in `fastifyOauth2` and the `urlOptions` built in `generateAuthorizationUriCallbacked`). That makes it impossible to put per-request values such as `login_hint` into the authorization uri that `startRedirectPath` redirects to. The only per-request hook that exists is the internal `kGenerateCallbackUriParams` symbol used by the Apple configuration, which isn't public and can't be set when using `discovery`. The current workaround is to drop `startRedirectPath`, call `generateAuthorizationUri` in your own route and edit the returned URL by hand.

This follows what #258 did for `callbackUri`: `callbackUriParams` can now also be a `(request) => object` function. It is called each time an authorization uri is generated (both for `startRedirectPath` and `generateAuthorizationUri`), and its result goes through the provider-specific hook as before, so Apple still gets `response_mode=form_post`. Passing an object works exactly as before.

Changes:
- `index.js`: accept a function in the option check, resolve it with the request before building the url options.
- `types/index.d.ts`: `callbackUriParams?: Object | ((req: FastifyRequest) => Object)`.
- README: short example using `login_hint` from a cookie with discovery.
- Tests: function used via `startRedirectPath` (two requests, different hints), via `generateAuthorizationUri`, and together with the Apple provider hook; type test for the function form.

Verified with `npm test` (lint, unit with 100% coverage, tstyche). New tests run against the unchanged `index.js`:

```
✔ options.callbackUriParams should be an object
✔ options.callbackUriParams
✖ options.callbackUriParams as a function
✖ options.callbackUriParams as a function with generateAuthorizationUri
✖ options.callbackUriParams as a function keeps provider specific params
  Error: options.callbackUriParams should be a object
```

With the change:

```
✔ options.callbackUriParams should be an object
✔ options.callbackUriParams
✔ options.callbackUriParams as a function
✔ options.callbackUriParams as a function with generateAuthorizationUri
✔ options.callbackUriParams as a function keeps provider specific params
ℹ tests 109
ℹ pass 109
ℹ fail 0
```

Left out on purpose: async functions (kept sync like `callbackUri`), and a separate public `generateCallbackUriParams(params, request, scope, state)` option. The function form covers the use case in the issue; happy to add the other one if you'd prefer that shape. The validation error message changed from "should be a object" to "should be a object or a function".
