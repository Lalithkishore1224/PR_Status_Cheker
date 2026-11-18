Fixes #157

The `separator` keyword (`index.js`, `separator.compile`) replaces the string value with `data.split(separator)` (or `[]` for an empty string), so the property ends up as `string[]` even though the schema says `type: 'string'`. The README never said how to type that.

The types don't need to change. `EnvSchemaOpt<T>['schema']` is `JSONSchemaType<T> | AnySchema`, so a plain schema object is accepted whatever `T` is, and `envSchema<{ ALLOWED_HOSTS: string[] }>(...)` returns `string[]` for that key. The error in the issue (`Type '"string"' is not assignable to type '"array"'`) comes from TypeScript 5.1 and older checking the inline literal against the `JSONSchemaType<T>` member of that union. From TypeScript 5.2 on, the issue's own snippet compiles unchanged against the current `types/index.d.ts`:

```
TS 4.9.5  current d.ts: a.ts(8,38): error TS2322: Type '"string"' is not assignable to type '"array"'.
TS 5.1.6  current d.ts: a.ts(8,38): error TS2322: Type '"string"' is not assignable to type '"array"'.
TS 5.2.2  current d.ts: (no errors)
TS 5.3.3  current d.ts: (no errors)
TS 5.9.3  current d.ts: (no errors)
TS 6.0.3  current d.ts: (no errors)
```

On 5.1 and older, declaring the schema as a separate `const` and passing it to `envSchema<Env>({ schema })` avoids the error.

## Changes

- README, TypeScript section: an example passing an interface with `ALLOWED_HOSTS: string[]` and a typebox example using `Type.Unsafe<string[]>({ type: 'string', separator: ',' })`. It also says what you get for an empty or unset value.
- `types/index.tst.ts`: type tests for both patterns, checking that `ALLOWED_HOSTS` is `string[]`.

## Verification

Runtime behaviour on the default branch, which the README note describes:

```
H='a,b'                              {"H":["a","b"]}
H='a'                                {"H":["a"]}
H='' (empty)                         {"H":[]}
H='a,,b,'                            {"H":["a","","b",""]}
H=' a , b '                          {"H":[" a "," b "]}
H missing, optional                  {}
H missing, required                  throws: env must have required property 'H'
H missing, default 'x,y'             {"H":["x","y"]}
H='' required                        {"H":[]}
```

So an unset optional variable with no default is left out of `config` entirely, not turned into `[]`. That is why the README says to make the property optional in that case.

The new type tests pass. If I change the expectation to `string`, both fail with `Type 'string[]' is not the same as type 'string'`, so they really check the array type.

`npm run lint` is clean and `npm test` passes: 48/48 unit tests with 100% coverage, and 23/23 tstyche assertions.

I also checked json-schema-to-ts 3.1.1 separately. `FromSchema` gives `string` for the property, and `FromSchema<typeof schema, { deserialize: [{ pattern: { type: 'string', separator: ',' }, output: string[] }] }>` gives `string[]`. I didn't add that to the README because it has no json-schema-to-ts section and the package isn't a dev dependency.

Left out on purpose: no changes to `types/index.d.ts`, and no attempt to make `JSONSchemaType<T>` itself accept `type: 'string'` for a `string[]` field. That would mean replacing ajv's type, which is a design decision.
