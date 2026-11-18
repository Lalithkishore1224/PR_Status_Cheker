Refs #7231

The default response for `FST_ERR_MAX_PARAM_LENGTH` is a 414 but its body says `"error": "Bad Request"`. This changes it to `"URI Too Long"` so it matches the status code, the same way `FST_ERR_BAD_URL` pairs 400 with `"Bad Request"`.

The `frameworkErrors` docs still said only `FST_ERR_BAD_URL` and `FST_ERR_ASYNC_CONSTRAINT` are supported, but `FST_ERR_MAX_PARAM_LENGTH` has gone through `frameworkErrors` since #6716. I've added it to the list. I also added a short note that these router-level errors are handled before a route is matched, so `onRequest`/`onSend` hooks and `setErrorHandler` don't run for them, and that `frameworkErrors` is the place to add things like CORS headers.

Before / after, using the repro from the issue:

```
# main
414 onRequest skipped {"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH",...,"statusCode":414}
# this branch
414 onRequest skipped {"error":"URI Too Long","code":"FST_ERR_MAX_PARAM_LENGTH",...,"statusCode":414}
```

I left the main part of the issue (running the full lifecycle for these errors) out of this PR on purpose. d66ebd12 deliberately made malformed and over-long URLs fail closed before any application not-found handler runs, and sending them through `onRequest` + `setErrorHandler` would undo part of that. If you'd rather go that way, or just log the request in the default path, I'm happy to follow up.

#### Checklist

- [x] run `npm run test` (lint, unit, types all pass)
- [x] tests and/or benchmarks are included
- [x] documentation is changed or added
