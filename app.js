'use strict'

const REMOTE_DATA = 'https://raw.githubusercontent.com/Lalithkishore1224/PR_Status_Cheker/data/data/prs.json'
const LOCAL_DATA = 'data/prs.json'
const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname)

// Every stage belongs to one bucket. The bucket answers "who has to move next?".
const STAGES = {
  not_opened: { label: 'Not opened', tone: 'bad', bucket: 'act', next: 'The branch is pushed and the description is written. Open the pull request.' },
  changes_requested: { label: 'Changes requested', tone: 'bad', bucket: 'act', next: 'A reviewer asked for changes. Read their review below and push an update.' },
  ci_failing: { label: 'CI failing', tone: 'bad', bucket: 'act', next: 'A check failed. Open it, fix the cause and push.' },
  reply_needed: { label: 'Reply needed', tone: 'bad', bucket: 'act', next: 'Someone commented after your last message. Read it and reply.' },
  ci_approval: { label: 'Waiting for CI approval', tone: 'warn', bucket: 'wait', next: 'Workflows from first-time contributors need a maintainer to approve them before CI runs. Nothing to do yet.' },
  ci_running: { label: 'CI running', tone: 'info', bucket: 'wait', next: 'Checks are still running.', live: true },
  in_review: { label: 'Waiting for review', tone: 'info', bucket: 'wait', next: 'CI is green. Waiting for a maintainer to review.' },
  approved: { label: 'Approved', tone: 'ok', bucket: 'wait', next: 'Approved. Waiting for a maintainer to merge.' },
  merged: { label: 'Merged', tone: 'ok', bucket: 'done', next: 'Merged. Nothing left to do.' },
  closed: { label: 'Closed', tone: 'idle', bucket: 'done', next: 'Closed without merging.' }
}
const BUCKETS = {
  all: { label: 'All pull requests', short: 'All', icon: 'M4 6h16M4 12h16M4 18h16' },
  act: { label: 'Needs you', short: 'Needs you', foot: 'Your move', icon: 'M12 4v9M12 17.5v.5' },
  wait: { label: 'With maintainers', short: 'With maintainers', foot: 'Review or CI pending', icon: 'M12 7v5l3 2M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z' },
  done: { label: 'Done', short: 'Done', foot: 'Merged or closed', icon: 'M5 12.5l4.5 4.5L19 7.5' }
}

const hash = new URLSearchParams(location.hash.slice(1))
const state = { data: null, view: hash.get('view') || 'all', open: new Set(hash.getAll('pr')), query: '' }
const $ = (sel) => document.querySelector(sel)

function esc (s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function md (text) {
  if (!text) return ''
  const html = DOMPurify.sanitize(marked.parse(text, { gfm: true }))
  return html.replace(/<a /g, '<a target="_blank" rel="noopener" ')
}

function ago (iso) {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  for (const [u, n] of [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]]) {
    if (s >= n) return `${Math.floor(s / n)}${u} ago`
  }
  return 'just now'
}

const fullDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''
const lastActivity = (pr) => pr.conversation.at(-1)?.at || pr.updatedAt || pr.createdAt || ''
const stageOf = (pr) => STAGES[pr.stage] || STAGES.in_review
const svg = (d, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const othersComments = (pr) => pr.conversation.filter(c => c.author?.login !== state.data.author && !c.author?.bot)

function ciCell (ci) {
  const s = ci.summary
  if (ci.awaitingApproval.length) return '<b>–</b>awaiting approval'
  if (!s.total) return '<b>–</b>no checks'
  if (s.failed) return `<b style="color:var(--danger)">${s.failed}</b>failed of ${s.total}`
  if (s.running) return `<b>${s.running}</b>running of ${s.total}`
  return `<b>${s.passed}/${s.total}</b>passed`
}

function counts () {
  const c = { all: state.data.prs.length, act: 0, wait: 0, done: 0 }
  for (const pr of state.data.prs) c[stageOf(pr).bucket]++
  return c
}

function matches (pr) {
  if (state.view !== 'all' && stageOf(pr).bucket !== state.view) return false
  if (!state.query) return true
  const hay = [pr.title, pr.repo, pr.number, pr.issue?.title, pr.issue?.number, pr.branch, stageOf(pr).label,
    ...pr.conversation.map(c => c.author?.login)].join(' ').toLowerCase()
  return state.query.split(/\s+/).every(t => hay.includes(t))
}

function renderNav () {
  const c = counts()
  $('#nav').innerHTML = '<div class="nav-label">Who moves next</div>' + Object.entries(BUCKETS).map(([id, b]) => `
    <button class="nav-item ${state.view === id ? 'active' : ''}" data-view="${id}">
      ${svg(b.icon)}<span>${b.short}</span>
      <span class="nav-badge ${id === 'act' && c.act ? 'hot' : ''}">${c[id]}</span>
    </button>`).join('')
}

function renderKpis () {
  const c = counts()
  $('#kpis').innerHTML = ['act', 'wait', 'done'].map(id => `
    <button class="kpi ${state.view === id ? 'active' : ''}" data-view="${id}">
      <div class="kpi-top"><span class="kpi-label">${BUCKETS[id].label}</span></div>
      <div class="kpi-value ${id === 'act' && c.act ? 'bad' : ''}">${c[id]}</div>
      <div class="kpi-foot">${BUCKETS[id].foot}</div>
    </button>`).join('')
}

function renderHead () {
  $('#view-title').textContent = BUCKETS[state.view].label
  const repos = new Set(state.data.prs.map(p => p.repo)).size
  $('#view-sub').textContent = `${state.data.prs.length} pull requests across ${repos} repositories`
  const age = (Date.now() - new Date(state.data.generatedAt)) / 60000
  $('#updated').textContent = `Synced ${ago(state.data.generatedAt)}`
  $('#updated').title = fullDate(state.data.generatedAt)
  $('#sync').classList.toggle('stale', age > 45)
  $('#ws-sub').textContent = `@${state.data.author}`
}

function renderList () {
  const prs = state.data.prs.filter(matches).sort((a, b) => {
    const order = { act: 0, wait: 1, done: 2 }
    return (order[stageOf(a).bucket] - order[stageOf(b).bucket]) || lastActivity(b).localeCompare(lastActivity(a))
  })
  if (!prs.length) {
    $('#list').innerHTML = `<div class="dt-empty"><b>Nothing here</b><span>${state.query ? 'No pull request matches the search.' : 'No pull requests in this view.'}</span></div>`
    return
  }
  $('#list').innerHTML = prs.map(pr => rowHtml(pr) + (state.open.has(pr.key) ? detailHtml(pr) : '')).join('')
}

function rowHtml (pr) {
  const st = stageOf(pr)
  const n = othersComments(pr).length
  const open = state.open.has(pr.key)
  return `
    <button class="trow ${open ? 'open' : ''}" data-key="${esc(pr.key)}" aria-expanded="${open}">
      <span class="row-dot ${st.tone}"></span>
      <span class="row-main">
        <span class="row-title" style="display:block">${esc(pr.title)}</span>
        <span class="row-sub"><span class="repo-tag">${esc(pr.repo)}</span>${pr.number ? `#${pr.number}` : 'draft'}${pr.issue ? ` · fixes #${pr.issue.number}` : ''}</span>
      </span>
      <span class="row-stage"><span class="pill ${st.tone} ${st.live ? 'live' : ''}">${st.label}</span></span>
      <span class="cell row-ci">${ciCell(pr.ci)}</span>
      <span class="cell"><b>${n}</b>${n === 1 ? 'comment' : 'comments'}</span>
      <span class="cell row-when" title="${esc(fullDate(lastActivity(pr)))}">${pr.number ? ago(lastActivity(pr)) : '–'}</span>
    </button>`
}

function checkTone (c) {
  if (c.status !== 'completed') return 'info'
  if (['success', 'neutral'].includes(c.conclusion)) return 'ok'
  if (['skipped', 'cancelled', 'stale'].includes(c.conclusion)) return 'idle'
  return 'bad'
}

function person (p, extra = '') {
  if (!p) return ''
  return `<a class="person" href="${esc(p.url)}" target="_blank" rel="noopener"><img class="avatar" src="${esc(p.avatar)}&s=44" alt="" loading="lazy">${esc(p.login)}${extra}</a>`
}

const ROLE = { OWNER: 'Owner', MEMBER: 'Maintainer', COLLABORATOR: 'Collaborator', CONTRIBUTOR: 'Contributor', FIRST_TIME_CONTRIBUTOR: 'First-time contributor', FIRST_TIMER: 'First-timer' }
const REVIEW = { APPROVED: ['Approved', 'ok'], CHANGES_REQUESTED: ['Changes requested', 'bad'], COMMENTED: ['Reviewed', 'info'], DISMISSED: ['Dismissed', 'idle'] }

function messageHtml (c) {
  const mine = c.author?.login === state.data.author
  const role = ROLE[c.author?.association]
  const review = c.kind === 'review' ? REVIEW[c.state] || ['Reviewed', 'info'] : null
  return `
    <li class="msg">
      <img class="avatar" src="${esc(c.author?.avatar)}&s=60" alt="" loading="lazy">
      <div class="bubble ${mine ? 'mine' : ''}">
        <div class="b-head">
          <a class="who" href="${esc(c.author?.url)}" target="_blank" rel="noopener">${esc(c.author?.login)}${mine ? ' (you)' : ''}</a>
          ${role && !mine ? `<span class="role">${role}</span>` : ''}
          ${review ? `<span class="pill ${review[1]}">${review[0]}</span>` : ''}
          ${c.kind === 'code' ? `<span class="where">${esc(c.path)}${c.line ? `:${c.line}` : ''}</span>` : ''}
          <a class="when" href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(fullDate(c.at))}">${ago(c.at)}</a>
        </div>
        ${c.body ? `<div class="md">${md(c.body)}</div>` : ''}
      </div>
    </li>`
}

function detailHtml (pr) {
  const st = stageOf(pr)
  const ci = pr.ci
  let next = st.next
  if (pr.stage === 'ci_approval') next += ` Pending: ${ci.awaitingApproval.map(esc).join(', ')}.`
  const action = pr.openUrl
    ? `<a class="button button-primary button-sm" href="${esc(pr.openUrl)}" target="_blank" rel="noopener">Open pull request ${svg('M7 17L17 7M9 7h8v8', 16)}</a>`
    : `<a class="button button-outline button-sm" href="${esc(pr.url)}" target="_blank" rel="noopener">View on GitHub ${svg('M7 17L17 7M9 7h8v8', 16)}</a>`

  if (!pr.number) {
    return `<div class="row-detail"><div class="rd-inner">
      <div class="next ${st.tone}"><p><b>${st.label}.</b> ${next}</p>${action}</div>
    </div></div>`
  }

  const people = new Map()
  for (const c of pr.conversation) if (c.author && !c.author.bot) people.set(c.author.login, c.author)

  return `
    <div class="row-detail"><div class="rd-inner">
      <div class="next ${st.tone}"><p><b>${st.label}.</b> ${next}</p>${action}</div>
      <div class="rd-grid">
        <div class="rd-block">
          <div class="rd-title">Overview</div>
          <div class="kv"><span>Opened</span><b title="${esc(fullDate(pr.createdAt))}">${ago(pr.createdAt)}</b></div>
          <div class="kv"><span>Changes</span><b><span class="add">+${pr.additions}</span> <span class="del">−${pr.deletions}</span> · ${pr.changedFiles} files</b></div>
          <div class="kv"><span>Branch</span><b class="mono" title="${esc(pr.branch)}">${esc(pr.branch)}</b></div>
          ${pr.issue ? `<div class="kv"><span>Issue</span><a href="${esc(pr.issue.url)}" target="_blank" rel="noopener">#${pr.issue.number} · ${esc(pr.issue.state)}</a></div>` : ''}
        </div>
        <div class="rd-block">
          <div class="rd-title"><span>Checks</span><span>${ci.summary.passed}/${ci.summary.total}</span></div>
          ${ci.checks.length || ci.awaitingApproval.length
            ? `<ul class="checks">
                ${ci.awaitingApproval.map(n => `<li class="warn"><span class="dot"></span>${esc(n)}<span class="pill warn" style="margin-left:auto">needs approval</span></li>`).join('')}
                ${ci.checks.map(c => `<li class="${checkTone(c)}"><span class="dot"></span><a href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.name)}">${esc(c.name)}</a></li>`).join('')}
              </ul>`
            : '<p class="empty-note">No checks reported yet.</p>'}
        </div>
        <div class="rd-block">
          <div class="rd-title">Reviews</div>
          ${pr.reviews.length || pr.requestedReviewers.length
            ? `<div class="people">
                ${pr.reviews.map(r => person(r.reviewer, ` <span class="pill ${REVIEW[r.state]?.[1] || 'info'}">${REVIEW[r.state]?.[0] || r.state}</span>`)).join('')}
                ${pr.requestedReviewers.map(p => person(p, ' · requested')).join('')}
              </div>`
            : '<p class="empty-note">No reviews yet.</p>'}
        </div>
      </div>
      <div class="convo">
        <div class="rd-title"><span>Conversation</span><span>${pr.conversation.length} ${pr.conversation.length === 1 ? 'entry' : 'entries'}</span></div>
        ${people.size ? `<div class="people">${[...people.values()].map(p => person(p)).join('')}</div>` : ''}
        ${pr.conversation.length
          ? `<ol class="timeline">${pr.conversation.map(messageHtml).join('')}</ol>`
          : '<p class="empty-note">No comments yet.</p>'}
      </div>
      <details class="desc"><summary>Your description</summary><div class="md">${md(pr.body)}</div></details>
    </div></div>`
}

function saveHash () {
  const p = new URLSearchParams()
  if (state.view !== 'all') p.set('view', state.view)
  for (const k of state.open) p.append('pr', k)
  const s = p.toString()
  history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search)
}

function render () {
  renderHead()
  renderNav()
  renderKpis()
  renderList()
}

function setView (view) {
  state.view = state.view === view && view !== 'all' ? 'all' : view
  saveHash()
  render()
  $('#shell').classList.remove('nav-open')
}

async function load () {
  const btn = $('#refresh')
  btn.classList.add('loading')
  const sources = isLocal ? [LOCAL_DATA, REMOTE_DATA] : [REMOTE_DATA, LOCAL_DATA]
  try {
    let data
    for (const src of sources) {
      try {
        const res = await fetch(`${src}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' })
        if (res.ok) { data = await res.json(); break }
      } catch {}
    }
    if (!data) throw new Error('Could not load PR data. Try Reload.')
    state.data = data
    render()
  } catch (err) {
    $('#list').innerHTML = `<div class="error">${esc(err.message)}</div>`
  } finally {
    btn.classList.remove('loading')
  }
}

const SUN = 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'
const MOON = 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z'
function paintThemeIcon () {
  $('#theme').innerHTML = svg(document.documentElement.dataset.theme === 'light' ? MOON : SUN)
}

$('#nav').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view) })
$('#kpis').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view) })
$('#list').addEventListener('click', e => {
  const row = e.target.closest('.trow')
  if (!row) return
  const key = row.dataset.key
  state.open.has(key) ? state.open.delete(key) : state.open.add(key)
  saveHash()
  renderList()
})
$('#search').addEventListener('input', e => { state.query = e.target.value.trim().toLowerCase(); renderList() })
$('#refresh').addEventListener('click', load)
$('#theme').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name=theme-color]').content = t === 'light' ? '#f6f8fc' : '#0a0a0b'
  try { localStorage.setItem('prs.theme', t) } catch {}
  paintThemeIcon()
})
$('#open-nav').addEventListener('click', () => $('#shell').classList.add('nav-open'))
$('#close-nav').addEventListener('click', () => $('#shell').classList.remove('nav-open'))
$('#scrim').addEventListener('click', () => $('#shell').classList.remove('nav-open'))
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== $('#search')) { e.preventDefault(); $('#search').focus() }
  if (e.key === 'Escape') $('#shell').classList.remove('nav-open')
})
setInterval(() => state.data && (renderHead(), renderList()), 60000)
setInterval(load, 5 * 60000)

paintThemeIcon()
load()
