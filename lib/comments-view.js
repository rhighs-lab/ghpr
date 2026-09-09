'use strict'

const { c, link, truncate, stateOf, width } = require('./render')

// The same turn reads differently depending on whose PR it is: on yours, a
// thread the author owes is yours to answer; on someone else's, it is theirs.
const TURN = {
  mine: {
    author: { label: 'needs you', color: c.red, rank: 0 },
    reviewer: { label: 'waiting', color: c.yellow, rank: 1 },
    resolved: { label: 'resolved', color: c.green, rank: 2 }
  },
  theirs: {
    author: { label: 'needs author', color: c.yellow, rank: 1 },
    reviewer: { label: 'needs review', color: c.red, rank: 0 },
    resolved: { label: 'resolved', color: c.green, rank: 2 }
  }
}

const KIND = {
  review: { label: 'review', color: c.magenta },
  comment: { label: 'comment', color: c.blue }
}

/** `…#discussion_r123` — the fragment is what identifies the comment. */
const fragment = url => {
  const frag = String(url).split('#')[1]
  return frag ? '#' + frag : String(url)
}

function age(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return c.dim('today')
  const label = `${days}d`
  if (days >= 30) return c.red(label)
  if (days >= 7) return c.yellow(label)
  return c.dim(label)
}

function location(t) {
  if (!t.path) return c.dim('(file removed)')
  return t.path + (t.line ? ':' + t.line : '')
}

function pad(s, n) {
  return s + ' '.repeat(Math.max(0, n - width(s)))
}

function commentsTable(rows, { termWidth, linkStyle }) {
  const cells = rows.map(row => ({
    ...row,
    linkText: linkStyle === 'full' ? row.url : fragment(row.url)
  }))
  const columns = [
    { key: 'kind', header: 'TYPE' },
    { key: 'status', header: 'STATUS' },
    { key: 'age', header: 'AGE' },
    { key: 'author', header: 'AUTHOR' },
    { key: 'location', header: 'LOCATION' },
    { key: 'comment', header: 'COMMENT' },
    { key: 'linkText', header: 'LINK' }
  ]

  for (const col of columns) {
    col.width = Math.max(width(col.header), ...cells.map(row => width(row[col.key] || '')))
  }

  const gutter = 2
  const comment = columns.find(col => col.key === 'comment')
  const fixed = columns
    .filter(col => col.key !== 'comment')
    .reduce((total, col) => total + col.width + gutter, 0)
  comment.width = Math.max(24, termWidth - fixed - 1)

  const line = values =>
    columns
      .map((col, i) => pad(values[i], col.width))
      .join(' '.repeat(gutter))
      .replace(/\s+$/, '')

  const out = [c.dim(line(columns.map(col => col.header)))]
  for (const row of cells) {
    out.push(
      line([
        row.kind,
        row.status,
        row.age,
        row.author,
        row.location,
        truncate(row.comment, comment.width),
        c.dim(link(row.linkText, row.url))
      ])
    )
  }
  return out
}

/**
 * Renders one PR's threads and notes as an indented block. Threads sort by
 * whose turn it is, then oldest first, so what is waiting on you sits at the
 * top of the block and the stalest is highest within that.
 */
function renderPr(pr, prMeta, opts) {
  const { showResolved, showBots, snippetWidth, noteLimit, linkStyle, me } = opts

  const author = prMeta ? prMeta.author.login : ''
  const isMine = author.toLowerCase() === String(me).toLowerCase()
  const turns = isMine ? TURN.mine : TURN.theirs

  const counts = {
    actionable: pr.threads.filter(t => turns[t.turn] && turns[t.turn].rank === 0).length,
    other: pr.threads.filter(t => turns[t.turn] && turns[t.turn].rank === 1).length,
    resolved: pr.threads.filter(t => t.turn === 'resolved').length
  }

  let threads = pr.threads
  if (!showResolved) threads = threads.filter(t => t.turn !== 'resolved')
  if (!showBots) threads = threads.filter(t => !t.bot)

  // Your own words are not a response to track, so they are dropped; the rest is
  // capped because this view is a to-do list, not a transcript.
  let notes = noteLimit > 0 ? pr.notes : []
  if (!showBots) notes = notes.filter(n => !n.bot)
  notes = notes.filter(n => n.author.toLowerCase() !== String(me).toLowerCase())
  const notesHidden = Math.max(0, notes.length - noteLimit)
  notes = notes.slice(0, noteLimit)

  const lines = []
  if (!threads.length && !notes.length) return { lines, counts }

  const state = prMeta ? stateOf(prMeta) : null
  const tally = [
    counts.actionable ? turns.author.color(`${counts.actionable} ${isMine ? 'need you' : 'to review'}`) : null,
    counts.other ? c.yellow(`${counts.other} ${isMine ? 'waiting' : 'on author'}`) : null,
    counts.resolved ? c.dim(`${counts.resolved} resolved`) : null
  ]
    .filter(Boolean)
    .join(c.dim(' · '))

  lines.push(
    `${c.cyan(link('#' + pr.number, pr.url))}  ${c.bold(truncate(pr.title, 62))}` +
      (isMine ? '' : c.dim(`  by ${author}`)) +
      (state ? `  ${state.color(state.label)}` : '')
  )
  if (tally) lines.push(`        ${tally}`)
  lines.push('')

  threads.sort(
    (a, b) => turns[a.turn].rank - turns[b.turn].rank || a.lastAt.localeCompare(b.lastAt)
  )

  const rows = []
  for (const t of threads) {
    const turn = turns[t.turn]
    const meta = [
      t.replies ? c.dim(`${t.replies} ${t.replies === 1 ? 'reply' : 'replies'}`) : null,
      t.outdated ? c.dim('outdated') : null
    ]
      .filter(Boolean)
      .join(c.dim(' · '))
    rows.push({
      kind: KIND.comment.color('thread'),
      status: turn.color(turn.label) + (meta ? c.dim(` · ${meta}`) : ''),
      age: age(t.lastAt),
      author: t.lastBy + (t.bot ? c.dim(' (bot)') : ''),
      location: location(t),
      comment: t.gist || '',
      url: t.url
    })
  }

  if (notes.length) {
    for (const n of notes) {
      const kind = KIND[n.kind] || KIND.comment
      rows.push({
        kind: kind.color(kind.label),
        status: n.kind === 'review' && n.state ? c.dim(n.state.toLowerCase()) : '',
        age: age(n.at),
        author: n.author + (n.bot ? c.dim(' (bot)') : ''),
        location: c.dim('PR'),
        comment: n.gist || '',
        url: n.url
      })
    }
  }

  lines.push(...commentsTable(rows, { termWidth: snippetWidth + 18, linkStyle }))
  if (notesHidden) lines.push(c.dim(`  +${notesHidden} older PR comments; use --notes N for more`))
  lines.push('')

  return { lines, counts }
}

module.exports = { renderPr, TURN, fragment, location }
