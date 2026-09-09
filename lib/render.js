'use strict'

const useColor = process.stdout.isTTY && !process.env.NO_COLOR

// Terminals that do not implement OSC 8 ignore the sequence, so the only real
// cost is on a non-TTY, where the escapes would corrupt piped output.
const useLinks = process.stdout.isTTY && !process.env.TEAM_PRS_NO_HYPERLINK

const paint = code => s => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s))

const c = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('34'),
  magenta: paint('35'),
  cyan: paint('36'),
  grey: paint('90')
}

/** Wraps text in an OSC 8 hyperlink, which occupies no visible columns. */
function link(text, url) {
  if (!useLinks || !url) return String(text)
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
}

// Visible width, ignoring both SGR colour codes and OSC 8 hyperlink wrappers.
const ESCAPES = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b\x07]*(?:\x1b\\|\x07)/g
const width = s => String(s).replace(ESCAPES, '').length

function pad(s, n, align = 'left') {
  const gap = Math.max(0, n - width(s))
  if (align === 'right') return ' '.repeat(gap) + s
  return s + ' '.repeat(gap)
}

function truncate(s, n) {
  s = String(s)
  if (s.length <= n) return s
  return n <= 1 ? s.slice(0, n) : s.slice(0, n - 1) + '…'
}

const STATE = {
  DRAFT: { label: 'draft', color: c.grey },
  REVIEW_REQUIRED: { label: 'needs review', color: c.yellow },
  CHANGES_REQUESTED: { label: 'changes req.', color: c.red },
  APPROVED: { label: 'approved', color: c.green },
  NONE: { label: 'no reviews', color: c.yellow }
}

function stateOf(pr) {
  if (pr.isDraft) return STATE.DRAFT
  return STATE[pr.reviewDecision] || STATE.NONE
}

function sizeCell(pr) {
  const add = `+${pr.additions}`
  const del = `-${pr.deletions}`
  return `${c.green(add)}/${c.red(del)}`
}

function ageDays(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function ageCell(iso) {
  const d = ageDays(iso)
  const label = d === 0 ? 'today' : `${d}d`
  if (d >= 30) return c.red(label)
  if (d >= 7) return c.yellow(label)
  return c.dim(label)
}

// Below this the title stops being scannable, so a full-URL link column gives
// way to the short form rather than squeezing it further.
const TITLE_FLOOR = 44

/** `https://github.com/o/r/pull/123` -> `…/123`, still clickable. */
const shortUrl = url => '\u2026/' + String(url).split('/').pop()

/**
 * Renders rows as an aligned table. Every column but the title is sized to its
 * content; the title takes the remaining width.
 *
 * `linkStyle` is 'full', 'short', 'off', or 'auto' to pick full when the titles
 * can still afford it. Returns the resolved style alongside the text.
 */
function table(rows, { termWidth, linkStyle = 'auto' }) {
  if (!rows.length) return { text: '', linkStyle: 'off' }

  const build = style => {
    const cols = [
      { key: 'number', header: 'PR', align: 'right' },
      { key: 'author', header: 'AUTHOR' },
      { key: 'state', header: 'STATE' },
      { key: 'size', header: 'SIZE', align: 'right' },
      { key: 'age', header: 'AGE', align: 'right' },
      { key: 'flags', header: '' },
      { key: 'title', header: 'TITLE' },
      ...(style === 'off' ? [] : [{ key: 'link', header: 'LINK' }])
    ]

    const cells = rows.map(r => ({
      ...r,
      link: style === 'off' ? '' : style === 'short' ? shortUrl(r.url) : r.url
    }))

    for (const col of cols) {
      col.width = Math.max(width(col.header), ...cells.map(r => width(r[col.key] ?? '')))
    }

    const gutter = 2
    const others = cols.filter(col => col.key !== 'title')
    const used = others.reduce((n, col) => n + col.width + gutter, 0)
    const titleCol = cols.find(col => col.key === 'title')
    titleCol.width = Math.max(20, termWidth - used - 1)

    return { cols, cells, gutter, titleWidth: titleCol.width }
  }

  let style = linkStyle
  if (style === 'auto') {
    style = build('full').titleWidth >= TITLE_FLOOR ? 'full' : 'short'
  }

  const { cols, cells, gutter, titleWidth } = build(style)

  const line = values =>
    cols
      .map((col, i) => pad(values[i], col.width, col.align))
      .join(' '.repeat(gutter))
      .replace(/\s+$/, '')

  const out = [c.dim(line(cols.map(col => col.header)))]

  for (const r of cells) {
    const values = [
      c.cyan(link(r.number, r.url)),
      r.author,
      r.state,
      r.size,
      r.age,
      r.flags,
      truncate(r.title, titleWidth)
    ]
    // The link text is never truncated: a clipped URL is worse than a short one.
    if (style !== 'off') values.push(c.dim(link(r.link, r.url)))
    out.push(line(values))
  }

  return { text: out.join('\n'), linkStyle: style }
}

module.exports = { c, link, table, stateOf, sizeCell, ageCell, ageDays, truncate, width }
