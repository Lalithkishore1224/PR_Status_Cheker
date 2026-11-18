Fixes #54

`fastify.inject()` returns an empty payload for any request that goes through the express stack. That covers express routes and routers, and also plain Fastify routes once any `fastify.use()` middleware is registered. The status code and headers are correct, but the body is `''`.

Root cause: `runConnect` in `index.js` hands `req.raw`/`reply.raw` to express, and express's `app.handle` (`express/lib/application.js`) does `Object.setPrototypeOf(res, this.response)`. For an injected request, `reply.raw` is a light-my-request `Response`. Its prototype overrides `write`, `end`, `writeHead` and a few more methods to collect the payload. Once the prototype is swapped, those overrides are lost and the plain `http.ServerResponse` methods write to the mock socket instead. The existing tests that use inject only check status codes, so this never showed up.

What changed: when `req.raw.isLightMyRequest` is set (a documented light-my-request marker), `runConnect` copies the own methods of the req/res prototype onto the instance before calling express. Express still swaps the prototype, but the instance properties shadow it, so light-my-request's methods keep working. Express's own methods (`res.json`, `res.send`, `req.get`, ...) are not affected because light-my-request doesn't define them. Requests from a real server never get this flag, so the normal HTTP path doesn't change.

Tests: added `test/inject.test.js`. It covers an express app route with `res.json` and a status/header, a router with `res.send` and `res.end`, a POST body parsed by `express.json()`, and a Fastify route (JSON and stream) behind an express middleware. All 5 fail without the change to `index.js` and pass with it. `npm test` passes: lint, 78 unit tests with 100% coverage, and tstyche.

Repro script (fastify 5.12.8, light-my-request 6.8.0, express 5.3.0): express routes mounted with `fastify.use()`, then `fastify.inject()`:

Before:
```
/json 200 application/json; charset=utf-8 ""
/send 201 text/plain; charset=utf-8 ""
/end 200 undefined ""
/app 200 application/json; charset=utf-8 ""
/body 200 application/json; charset=utf-8 ""
/f 200 ""          <- fastify route behind fastify.use((req, res, next) => next())
```

After:
```
/json 200 application/json; charset=utf-8 "{\"hello\":\"world\"}"
/send 201 text/plain; charset=utf-8 "text body"
/end 200 undefined "raw end"
/app 200 application/json; charset=utf-8 "{\"from\":\"app\"}"
/body 200 application/json; charset=utf-8 "{\"a\":1}"
/f 200 "{\"fastify\":true}"
```

Left out: I only copy methods from the immediate prototype of the injected req/res. That prototype is the one light-my-request builds, and it also covers its custom `Request` option, because light-my-request copies its methods onto that constructor's prototype. Methods that a user-supplied `Request` class inherits from further up its own chain are not preserved. I didn't add a README note because inject should now just work.
