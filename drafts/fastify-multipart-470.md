Refs #470

I reproduced this on main with a real request: two 4 MB files, `limits: { fileSize: 1000 }`, the default `throwFileSizeLimit`, sent in 64 KB chunks.

The temp files themselves were never leaked. When `saveRequestFiles()` throws, its catch block already runs `cleanRequestFiles()`, so the directory was empty both after the error and after a second `cleanRequestFiles()` call. The comments were right about the other half, though: the error only came back after the whole body had been read, and the second file was fully written to disk before that.

The cause is in `saveRequestFiles()` in `index.js`. Once busboy hits `fileSize`, it marks the file stream `truncated` and ends it normally, so `pump(part.file, target)` resolves and the loop moves on to the next part. The `RequestFileTooLargeError` set by the `limit` listener is only stored as `lastError`, and the iterator hands it back when busboy finishes the request. `toBuffer()` doesn't have this problem because it checks `file.truncated` itself and throws.

The fix does the same check in `saveRequestFiles()`. After each file is written, if `part.file.truncated` is set and `throwFileSizeLimit` is on (read from the call options, otherwise the plugin default), it throws `RequestFileTooLargeError` with `err.part` set. The existing catch block then removes the partial temp file. When `throwFileSizeLimit: false`, nothing changes and truncated files are still saved.

Before (main):

```
response: 413 {"code":"FST_REQ_FILE_TOO_LARGE"}
body size: 8388994 client had sent 8454144 bytes when error surfaced
tmp files right after error: [] (tmpUploads entries: 2)
tmp files after cleanRequestFiles: []
tmp files after response: []
```

After:

```
response: 413 {"code":"FST_REQ_FILE_TOO_LARGE"}
body size: 8388994 client had sent 4325376 bytes when error surfaced
tmp files right after error: [] (tmpUploads entries: 1)
tmp files after cleanRequestFiles: []
tmp files after response: []
```

`test/fix-470.test.js` adds two tests:
- An oversized file followed by a second file. It checks that the error is `RequestFileTooLargeError` for the right part, that only one temp file was created, that the tmpdir is empty, and that the response is a 413. It fails on main.
- The `throwFileSizeLimit: false` case, which still saves both truncated files.

`npm test` passes: lint, 124 unit tests at 100% coverage, and tstyche.

What I left out on purpose: busboy still reads the oversized part through to its boundary before the error surfaces. With a single 3.7 GB file, the client still uploads the whole file before getting the 413. Failing at the moment the limit fires would mean either destroying the file stream mid-part and leaving the rest of the request unread, or closing the connection as suggested in the thread. Both change how the request and connection end, so I think that decision belongs with the maintainers and isn't part of this PR. That's why this says Refs and not Fixes.
