Fixes #344

When the plugin is registered with `decoratorName: 'jwtUser'`, the decoded token is stored on `request.jwtUser`, but nothing in the types knows about that property, and the README did not say how to declare it. The snippet in the issue does two things that look reasonable but have no effect:

- it augments `FastifyRequest` inside `declare module '@fastify/jwt'`. `FastifyRequest` belongs to the `fastify` module (types/index.d.ts augments it there), so this declares an unrelated, unused interface.
- it adds a `jwtUser` key to `FastifyJWT`. `UserType` in types/index.d.ts only reads the `user` key, which is the name of the user type, not the decorator.

There is no typing bug in `types/index.d.ts`; the property name is a runtime option the types cannot follow, so the fix is documentation.

Changes:

- README, TypeScript section: new "Custom decorator name" subsection showing `FastifyRequest` augmented in `fastify`, and explaining that `user` in `FastifyJWT` keeps that name whatever `decoratorName` is (it still types `formatUser`'s return value). The `decoratorName` option section links to it.
- `types/decorator-name.tst.ts`: tstyche test for the documented setup (`request.jwtUser` typed, `jwtSign` payload type, `formatUser` input/return checked against `FastifyJWT`).

Verification

Issue snippet, as a tstyche test on main:

```
fail ./types/repro.tst.ts
Error: Property 'jwtUser' does not exist on type 'FastifyRequest<RouteGenericInterface, ...>'. ts(2339)
```

The README snippet extracted verbatim into a `.d.ts` + `.ts` pair and checked with `tsc --strict`, resolving `@fastify/jwt` to `types/index.d.ts`:

```
tsc exit 0
```

Same files with `declare module "fastify"` switched to `declare module "@fastify/jwt"` (the issue's variant):

```
readme-check/index.ts(12,11): error TS2339: Property 'jwtUser' does not exist on type 'FastifyRequest<...>'.
tsc exit (issue variant) 2
```

The new type test also fails (2 of 6 assertions) if its `fastify` augmentation is moved into `@fastify/jwt`. `npm test`: lint clean, 201/201 unit tests, 100% coverage, 3 type test files / 52 assertions passing.

Left out: `request.user` stays declared on `FastifyRequest` even when a custom `decoratorName` is used (it is just not set at runtime). Removing it would need the decorator name to flow into the types, which is a design change rather than a docs fix; the README notes the behaviour instead.
