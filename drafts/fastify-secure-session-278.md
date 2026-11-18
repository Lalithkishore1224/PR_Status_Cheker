Fixes #278

Session data goes through a hardcoded `JSON.stringify` in `encodeSecureSession` and `JSON.parse` in `decodeSecureSession` (index.js). Putting a BigInt in the session makes `JSON.stringify` throw `TypeError: Do not know how to serialize a BigInt`, and the request ends in a 500. There was no way to change how the data is encoded.

I didn't change the default encoding. Turning BigInts into strings by default (as #307 tried) would mean they come back as strings, and that changes what's stored for everyone. Instead this adds an opt-in `serializer` option:

```js
fastify.register(require('@fastify/secure-session'), {
  key,
  serializer: {
    stringify: (data) => JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? { $bigint: value.toString() } : value),
    parse: (text) => JSON.parse(text, (_key, value) =>
      value !== null && typeof value === 'object' && typeof value.$bigint === 'string'
        ? BigInt(value.$bigint)
        : value)
  }
})
```

Changes:
- `index.js`: each session's options take `serializer` (default `JSON`). It's stored with the session's key and expiry and used by `encodeSecureSession` / `decodeSecureSession`. Registration fails with `serializer must have stringify and parse functions` if either function is missing. `parse` gets the decrypted message as a string.
- `types/index.d.ts`: new `SessionSerializer` interface and an optional `serializer` field on `SecureSessionPluginOptions`.
- `README.md`: a "Custom serializer" section with the BigInt example and two caveats: `__ts` has to round-trip as a number, and if you switch serializers, `parse` still has to read old cookies.
- `test/serializer.test.js`: tests a BigInt round trip through real requests (top-level and nested), checks that the encode/decode decorators call the serializer, checks per-session serializers with multiple sessions, and checks the validation error. Type tests are in `types/index.tst.ts`.

Verification. Repro script: a POST route sets `9007199254740993n`, and a GET route reads it back from the cookie.

Before (main) and after with no `serializer`, which is unchanged:
```
POST 500 Do not know how to serialize a BigInt
```

After, with the serializer above:
```
POST 200 set-cookie present: true
GET 200 {"type":"bigint","value":"9007199254740993"}
```

With index.js reverted, all 4 new tests fail. With types/index.d.ts reverted, the type tests fail. `npm test` passes: 54 unit tests with 100% coverage, 18 tstyche assertions. Lint is clean.

Left out on purpose: there's no built-in BigInt encoding, and I didn't catch errors thrown by a custom `parse`. Those errors propagate the same way a `JSON.parse` failure would today.
