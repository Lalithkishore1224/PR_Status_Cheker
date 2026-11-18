# PR Status

A small dashboard for the pull requests I have open across the Fastify org. For each one it shows the
stage it's in and who has to move next, CI checks, reviews, and the full conversation (comments,
review comments on code, review verdicts), with the commenter and their role.

## How it works

- `tracked.json` lists the PRs to follow: repo, issue, and the branch on my fork. A branch with no PR yet
  shows as "Not opened" with a link that opens GitHub's compare page with the title and description filled in
  from `drafts/`. Any other PR I open in the org is picked up through search.
- `scripts/fetch.mjs` reads everything from the GitHub API and writes `data/prs.json`.
- `.github/workflows/update.yml` runs it every 15 minutes with the built-in `GITHUB_TOKEN`
  and force-pushes the result to the `data` branch, so `main` only holds code.
- The page (`index.html`, `app.js`, `styles.css`) is static and reads the JSON from that branch.
  No server, no stored secrets.

## Stages

| Bucket | Stages |
|---|---|
| Needs you | Not opened, Changes requested, CI failing, Reply needed |
| With maintainers | Waiting for CI approval, CI running, Waiting for review, Approved |
| Done | Merged, Closed |

## Run locally

```bash
node scripts/fetch.mjs   # uses GITHUB_TOKEN, or `gh auth token`
python3 -m http.server 4317
```

## Track another PR

Add an entry to `tracked.json` (`repo`, `issue`, `branch`, `title`, `draft`) and push. The workflow runs on push.
