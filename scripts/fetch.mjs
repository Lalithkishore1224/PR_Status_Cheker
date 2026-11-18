// Collects the state of every tracked pull request and writes data/prs.json.
// Runs in GitHub Actions with the built-in GITHUB_TOKEN; locally it falls back
// to `gh auth token` if GITHUB_TOKEN is not set.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execSync } from 'node:child_process'

const root = new URL('..', import.meta.url)
const config = JSON.parse(await readFile(new URL('tracked.json', root), 'utf8'))
const token = process.env.GITHUB_TOKEN || execSync('gh auth token').toString().trim()

async function gh (path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28'
    }
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`)
  return res.json()
}

const defaultBranches = new Map()
async function defaultBranch (repo) {
  if (!defaultBranches.has(repo)) defaultBranches.set(repo, (await gh(`/repos/${repo}`)).default_branch)
  return defaultBranches.get(repo)
}

function person (user, association) {
  return user && { login: user.login, avatar: user.avatar_url, url: user.html_url, bot: user.type === 'Bot', association }
}

async function checksFor (repo, sha) {
  const [runs, status, workflowRuns] = await Promise.all([
    gh(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`),
    gh(`/repos/${repo}/commits/${sha}/status`),
    gh(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`)
  ])
  const checks = (runs?.check_runs ?? []).map(c => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion,
    url: c.html_url
  }))
  for (const s of status?.statuses ?? []) {
    checks.push({
      name: s.context,
      status: s.state === 'pending' ? 'in_progress' : 'completed',
      conclusion: s.state === 'pending' ? null : s.state === 'error' ? 'failure' : s.state,
      url: s.target_url
    })
  }
  // Workflows from first-time contributors wait for a maintainer to approve them.
  const awaitingApproval = (workflowRuns?.workflow_runs ?? [])
    .filter(r => r.conclusion === 'action_required' || r.status === 'action_required' || r.status === 'waiting')
    .map(r => r.name)
  return { checks, awaitingApproval }
}

function summarize (checks) {
  const s = { total: checks.length, passed: 0, failed: 0, running: 0, skipped: 0 }
  for (const c of checks) {
    if (c.status !== 'completed') s.running++
    else if (['success', 'neutral'].includes(c.conclusion)) s.passed++
    else if (['skipped', 'cancelled', 'stale'].includes(c.conclusion)) s.skipped++
    else s.failed++
  }
  return s
}

function latestReviewStates (reviews) {
  const byUser = new Map()
  for (const r of reviews) {
    if (r.state === 'COMMENTED' || r.state === 'PENDING') continue
    byUser.set(r.user.login, { reviewer: person(r.user, r.author_association), state: r.state, at: r.submitted_at })
  }
  return [...byUser.values()]
}

function stageOf (pr, ci, reviews, conversation, author) {
  if (!pr) return 'not_opened'
  if (pr.merged_at) return 'merged'
  if (pr.state === 'closed') return 'closed'
  if (reviews.some(r => r.state === 'CHANGES_REQUESTED')) return 'changes_requested'
  if (ci.summary.failed > 0) return 'ci_failing'
  const last = conversation.at(-1)
  if (last && last.author?.login !== author && !last.author?.bot) return 'reply_needed'
  if (ci.awaitingApproval.length > 0) return 'ci_approval'
  if (ci.summary.running > 0) return 'ci_running'
  if (reviews.some(r => r.state === 'APPROVED')) return 'approved'
  return 'in_review'
}

async function collect (item) {
  const [owner] = item.repo.split('/')
  const issue = await gh(`/repos/${item.repo}/issues/${item.issue}`)
  const base = item.base || await defaultBranch(item.repo)
  let pr = null
  if (item.number) pr = await gh(`/repos/${item.repo}/pulls/${item.number}`)
  else if (item.branch) {
    const list = await gh(`/repos/${item.repo}/pulls?state=all&head=${config.author}:${encodeURIComponent(item.branch)}`)
    if (list?.length) pr = await gh(`/repos/${item.repo}/pulls/${list[0].number}`)
  }

  const linkedIssue = issue && {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state
  }

  if (!pr) {
    let body = ''
    try { body = await readFile(new URL(`drafts/${item.draft}.md`, root), 'utf8') } catch {}
    const qs = new URLSearchParams({ quick_pull: '1', title: item.title, body })
    const repoName = item.repo.split('/')[1]
    return {
      key: `${item.repo}#draft-${item.issue}`,
      repo: item.repo,
      title: item.title,
      stage: 'not_opened',
      issue: linkedIssue,
      branch: item.branch,
      openUrl: `https://github.com/${item.repo}/compare/${base}...${config.author}:${repoName}:${item.branch}?${qs}`,
      conversation: [],
      reviews: [],
      ci: { checks: [], summary: summarize([]), awaitingApproval: [] }
    }
  }

  const n = pr.number
  const [issueComments, reviewComments, reviews, ci] = await Promise.all([
    gh(`/repos/${item.repo}/issues/${n}/comments?per_page=100`),
    gh(`/repos/${item.repo}/pulls/${n}/comments?per_page=100`),
    gh(`/repos/${item.repo}/pulls/${n}/reviews?per_page=100`),
    checksFor(item.repo, pr.head.sha)
  ])
  ci.summary = summarize(ci.checks)

  const conversation = [
    ...issueComments.map(c => ({ kind: 'comment', author: person(c.user, c.author_association), body: c.body, at: c.created_at, url: c.html_url })),
    ...reviewComments.map(c => ({ kind: 'code', author: person(c.user, c.author_association), body: c.body, at: c.created_at, url: c.html_url, path: c.path, line: c.line ?? c.original_line })),
    ...reviews.filter(r => r.body || r.state !== 'COMMENTED').map(r => ({ kind: 'review', state: r.state, author: person(r.user, r.author_association), body: r.body, at: r.submitted_at, url: r.html_url }))
  ].sort((a, b) => a.at.localeCompare(b.at))

  const reviewStates = latestReviewStates(reviews)
  return {
    key: `${item.repo}#${n}`,
    repo: item.repo,
    number: n,
    title: pr.title,
    url: pr.html_url,
    body: pr.body,
    draft: pr.draft,
    state: pr.state,
    mergedAt: pr.merged_at,
    closedAt: pr.closed_at,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    branch: pr.head.ref,
    base: pr.base.ref,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    mergeable: pr.mergeable_state,
    labels: pr.labels.map(l => ({ name: l.name, color: l.color })),
    requestedReviewers: pr.requested_reviewers.map(u => person(u)),
    issue: linkedIssue,
    reviews: reviewStates,
    conversation,
    ci,
    stage: stageOf(pr, ci, reviewStates, conversation, config.author)
  }
}

const items = [...config.items]
const seen = new Set(items.filter(i => i.number).map(i => `${i.repo}#${i.number}`))
// Pick up PRs opened outside the tracked list too.
const found = await gh(`/search/issues?q=${encodeURIComponent(config.discover)}&per_page=100`)
const results = await Promise.all(items.map(collect))
for (const r of results) if (r.number) seen.add(r.key)
for (const hit of found?.items ?? []) {
  const repo = hit.repository_url.replace('https://api.github.com/repos/', '')
  if (seen.has(`${repo}#${hit.number}`)) continue
  const m = /(?:fixes|closes|resolves|refs)\s+#(\d+)/i.exec(hit.body || '')
  results.push(await collect({ repo, number: hit.number, issue: m ? Number(m[1]) : hit.number }))
}

await mkdir(new URL('data/', root), { recursive: true })
await writeFile(new URL('data/prs.json', root), JSON.stringify({ generatedAt: new Date().toISOString(), author: config.author, prs: results }, null, 2))
console.log(`wrote ${results.length} PRs`)
