#!/usr/bin/env node
'use strict'

const gh = require('../lib/gh')
const cache = require('../lib/cache')
const config = require('../lib/config')
const { c, table, stateOf, sizeCell, ageCell } = require('../lib/render')
const { fetchThreads } = require('../lib/threads')
const { renderPr } = require('../lib/comments-view')

const MEMBER_TTL = 24 * 60 * 60 * 1000

const USAGE = `
${c.bold('ghpr')} — open pull requests from your GitHub team

${c.bold('USAGE')}
  ghpr [options]

${c.bold('OPTIONS')}
  -r, --repo <owner/repo>   repository to query
  -b, --base <branch>       only PRs targeting this branch ("--base any" for all)
  -t, --team <org/slug>     team whose members to include
      --link <style>        full | short | off | auto   (default: auto)
      --no-link             same as --link off (the PR number stays clickable)
      --filter <cols>       keep only these columns, e.g. --filter author,size
                            pr | author | state | size | age | flags | title | link
      --comments            show review threads and replies instead of the table
      --resolved            include resolved threads (with --comments)
      --no-bots             hide bot threads and comments (with --comments)
      --notes <n>           how many PR-level comments to show, 0 for none (default: 3)
      --ready               only PRs you could review now (no drafts, no yours, unapproved)
      --requested           only PRs you (or your teams) were asked to review
      --mine                only PRs you authored
  -a, --author <login>      only PRs by this author (repeatable)
      --sort <key>          created | updated | size | age   (default: created)
  -n, --limit <n>           how many open PRs to fetch (default: ${config.DEFAULTS.limit})
      --json                emit JSON instead of a table
      --no-summary          skip the counts line
      --teams               list the teams you belong to, then exit
      --save                persist --repo/--base/--team as your defaults
      --clear-cache         drop the cached team rosters
  -h, --help                show this help

${c.bold('DEFAULTS')}
  repo ${c.cyan(config.DEFAULTS.repo)}   base ${c.cyan(config.DEFAULTS.base)}   team ${c.cyan(config.DEFAULTS.team)}
  Override per-run with flags, per-shell with TEAM_PRS_REPO / TEAM_PRS_BASE / TEAM_PRS_TEAM,
  or permanently with --save.

${c.bold('EXAMPLES')}
  ghpr                       ${c.dim('# every open team PR on the default base')}
  ghpr --ready               ${c.dim('# just the ones worth opening now')}
  ghpr --requested           ${c.dim('# PRs asking you for review')}
  ghpr --base any --mine     ${c.dim('# your PRs, any target branch')}
  ghpr -t Kong/gateway       ${c.dim('# a different team')}
  ghpr --json | jq '.[0]'    ${c.dim('# pipe it somewhere')}
  ghpr --ready --link full    ${c.dim('# force whole URLs, whatever the width')}
  ghpr --filter author,size,link ${c.dim('# only the columns you name')}

${c.bold('TRACKING RESPONSES')}
  ghpr --comments            ${c.dim('# threads on your PRs, newest reply first')}
  ghpr --comments --no-bots  ${c.dim('# drop the changelog/luacheck bots')}
  ghpr --comments -a oowl    ${c.dim("# threads on someone else's PRs")}

  On ${c.bold('your')} PRs:      ${c.red('needs you')} = someone replied and you have not.
                   ${c.yellow('waiting')}   = you replied last, still open.
  On ${c.bold('others')} PRs:    ${c.red('needs review')} = the author replied last.
                   ${c.yellow('needs author')} = a reviewer replied last.
  Without an author filter, ${c.bold('--comments')} looks at your own PRs.
`

function parseArgs(argv) {
  const opts = { authors: [] }

  const next = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('-')) throw new Error(`${flag} needs a value`)
    return v
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '-h': case '--help': opts.help = true; break
      case '-r': case '--repo': opts.repo = next(i, a); i++; break
      case '-b': case '--base': opts.base = next(i, a); i++; break
      case '-t': case '--team': opts.team = next(i, a); i++; break
      case '-a': case '--author': opts.authors.push(next(i, a)); i++; break
      case '--sort': opts.sort = next(i, a); i++; break
      case '-n': case '--limit': opts.limit = Number(next(i, a)); i++; break
      case '--link': opts.link = next(i, a); i++; break
      case '--no-link': opts.link = 'off'; break
      case '--filter': opts.filter = next(i, a); i++; break
      case '--comments': case '--threads': opts.comments = true; break
      case '--resolved': opts.resolved = true; break
      case '--no-bots': opts.noBots = true; break
      case '--notes': opts.notes = Number(next(i, a)); i++; break
      case '--no-notes': opts.notes = 0; break
      case '--ready': opts.ready = true; break
      case '--requested': opts.requested = true; break
      case '--mine': opts.mine = true; break
      case '--json': opts.json = true; break
      case '--no-summary': opts.noSummary = true; break
      case '--teams': opts.teams = true; break
      case '--save': opts.save = true; break
      case '--clear-cache': opts.clearCache = true; break
      default:
        throw new Error(`unknown option: ${a}\nRun "ghpr --help".`)
    }
  }

  if (opts.limit !== undefined && (!Number.isFinite(opts.limit) || opts.limit < 1)) {
    throw new Error('--limit must be a positive number')
  }

  const sorts = ['created', 'updated', 'size', 'age']
  if (opts.sort && !sorts.includes(opts.sort)) {
    throw new Error(`--sort must be one of: ${sorts.join(', ')}`)
  }

  if (opts.notes !== undefined && (!Number.isInteger(opts.notes) || opts.notes < 0)) {
    throw new Error('--notes must be 0 or a positive whole number')
  }

  const styles = ['full', 'short', 'off', 'auto']
  if (opts.link && !styles.includes(opts.link)) {
    throw new Error(`--link must be one of: ${styles.join(', ')}`)
  }

  const ALIAS = { number: 'pr', changes: 'size', diff: 'size' }
  const COLUMNS = ['pr', 'author', 'state', 'size', 'age', 'flags', 'title', 'link']
  if (opts.filter !== undefined) {
    const names = opts.filter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (!names.length) throw new Error(`--filter needs at least one column: ${COLUMNS.join(', ')}`)
    const unknown = names.filter(n => !COLUMNS.includes(ALIAS[n] || n))
    if (unknown.length) {
      throw new Error(
        `--filter: unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}\n` +
          `Columns: ${COLUMNS.join(', ')} (aliases: number=pr, changes=size)`
      )
    }
    opts.columns = new Set(names.map(n => ALIAS[n] || n))
  }

  return opts
}

function resolveMembers(teamRef) {
  const [org, slug] = teamRef.split('/')
  if (!org || !slug) throw new Error(`--team must look like "org/slug", got "${teamRef}"`)

  const key = `members-${org}-${slug}`
  const hit = cache.read(key, MEMBER_TTL)
  if (hit) return { org, slug, members: hit, cached: true }

  const members = gh.teamMembers(org, slug)
  cache.write(key, members)
  return { org, slug, members, cached: false }
}

function sortPrs(prs, key) {
  const by = {
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    age: (a, b) => a.createdAt.localeCompare(b.createdAt),
    size: (a, b) => b.additions + b.deletions - (a.additions + a.deletions)
  }
  return prs.slice().sort(by[key] || by.created)
}

const THREAD_PR_CAP = 25

function renderComments(prs, { repo, me, org, slug, members, opts }) {
  if (prs.length > THREAD_PR_CAP) {
    console.log(
      c.dim(
        `\n  ${prs.length} PRs matched; reading threads for the ${THREAD_PR_CAP} most recent. ` +
          `Narrow with --author or --ready.`
      )
    )
    prs = prs.slice(0, THREAD_PR_CAP)
  }

  const termWidth = process.stdout.columns || Number(process.env.COLUMNS) || 120
  const snippetWidth = Math.max(40, termWidth - 18)

  const scope = opts.authors.length ? opts.authors.join(', ') : me

  if (!opts.json) {
    console.log(
      `\n${c.bold(repo)}   threads on ${c.magenta(scope)}'s PRs ${c.dim(`(${prs.length} open)`)}\n`
    )
  }

  const fetched = []
  for (const pr of prs) {
    try {
      fetched.push({ data: fetchThreads(repo, pr.number, pr.author.login), meta: pr })
    } catch (err) {
      const line = `  #${pr.number}: could not read threads — ${err.message.split('\n')[0]}`
      if (opts.json) console.error(line)
      else console.log(c.red(line))
    }
  }

  if (opts.json) {
    const payload = fetched.map(({ data, meta }) => ({
      number: data.number,
      title: data.title,
      url: data.url,
      author: meta.author.login,
      reviewDecision: meta.reviewDecision,
      isDraft: meta.isDraft,
      threads: data.threads,
      notes: data.notes
    }))
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    return
  }

  const totals = { actionable: 0, other: 0, resolved: 0, prsActionable: 0 }
  let printed = 0

  for (const { data, meta } of fetched) {
    const { lines, counts } = renderPr(data, meta, {
      showResolved: !!opts.resolved,
      showBots: !opts.noBots,
      noteLimit: opts.notes === undefined ? 3 : opts.notes,
      snippetWidth,
      linkStyle: opts.link === 'full' ? 'full' : 'fragment',
      me
    })

    totals.actionable += counts.actionable
    totals.other += counts.other
    totals.resolved += counts.resolved
    if (counts.actionable) totals.prsActionable++

    if (lines.length) {
      printed++
      console.log(lines.join('\n'))
    }
  }

  if (!printed) {
    console.log(c.dim('  Nothing open. Every thread is resolved or there are none.\n'))
  }

  if (!opts.noSummary) {
    console.log(
      c.dim(
        `  ${totals.actionable} threads need action across ${totals.prsActionable} PRs · ` +
          `${totals.other} on the other side · ${totals.resolved} resolved`
      )
    )
    if (!opts.resolved && totals.resolved) {
      console.log(c.dim('  See the resolved ones with ') + c.bold('--resolved'))
    }
    console.log()
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.help) {
    process.stdout.write(USAGE)
    return
  }

  if (opts.clearCache) {
    console.log(`cleared ${cache.clear()}`)
    if (process.argv.length === 3) return
  }

  if (opts.teams) {
    const mine = gh.myTeams()
    console.log(c.bold('\nYour teams\n'))
    for (const t of mine) console.log(`  ${c.cyan(`${t.org}/${t.slug}`)}`)
    console.log(`\n${c.dim('Use one with:')} ghpr -t <org/slug>\n`)
    return
  }

  const cfg = config.load()
  const repo = opts.repo || cfg.repo
  const base = opts.base || cfg.base
  const team = opts.team || cfg.team
  const limit = opts.limit || cfg.limit

  if (opts.save) {
    const { file } = config.save({ repo, base, team })
    console.log(`saved defaults to ${file}`)
  }

  const me = gh.currentLogin()
  const { org, slug, members } = resolveMembers(team)
  const roster = new Set(members)

  const baseFilter = base && base !== 'any' ? base : null
  const all = gh.openPullRequests(repo, baseFilter, limit)

  let prs = all.filter(p => roster.has(p.author.login))

  if (opts.requested) {
    const mySlugs = new Set(gh.myTeams().map(t => t.slug))
    prs = all.filter(
      p => !p.isDraft && (p.reviewRequests || []).some(
        r =>
          (r.login || '').toLowerCase() === me.toLowerCase() ||
          (r.slug && mySlugs.has(r.slug))
      )
    )
  }

  const counts = {
    fetched: all.length,
    team: prs.length,
    mine: prs.filter(p => p.author.login === me).length,
    drafts: prs.filter(p => p.isDraft).length,
    approved: prs.filter(p => !p.isDraft && p.reviewDecision === 'APPROVED').length
  }
  counts.ready = prs.filter(
    p => !p.isDraft && p.author.login !== me && p.reviewDecision !== 'APPROVED'
  ).length

  if (opts.ready) {
    prs = prs.filter(p => !p.isDraft && p.author.login !== me && p.reviewDecision !== 'APPROVED')
  }
  // Threads are about tracking replies, so with no author named the subject is you.
  if (opts.comments && !opts.mine && !opts.authors.length && !opts.ready) opts.mine = true

  if (opts.mine) prs = prs.filter(p => p.author.login === me)
  if (opts.authors.length) {
    const want = new Set(opts.authors.map(a => a.toLowerCase()))
    prs = prs.filter(p => want.has(p.author.login.toLowerCase()))
  }

  prs = sortPrs(prs, opts.sort)

  if (opts.comments) {
    return renderComments(prs, { repo, me, org, slug, members, opts })
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(prs, null, 2) + '\n')
    return
  }

  const scope = baseFilter ? `→ ${c.cyan(baseFilter)}` : c.dim('(any base)')
  console.log(
    `\n${c.bold(repo)} ${scope}   team ${c.magenta(`${org}/${slug}`)} ${c.dim(`(${members.length} members)`)}\n`
  )

  if (!prs.length) {
    console.log(c.dim('  No matching pull requests.\n'))
    return
  }

  const rows = prs.map(p => {
    const state = stateOf(p)
    const flags = []
    if (p.author.login === me) flags.push(c.blue('you'))
    const requested = (p.reviewRequests || []).some(
      r => (r.login || '').toLowerCase() === me.toLowerCase() || (r.slug || '') === slug
    )
    if (requested) flags.push(c.magenta('asked'))

    return {
      number: `#${p.number}`,
      author: p.author.login,
      state: state.color(state.label),
      size: sizeCell(p),
      age: ageCell(p.createdAt),
      flags: flags.join(' '),
      title: p.title,
      url: p.url
    }
  })

  const termWidth = process.stdout.columns || Number(process.env.COLUMNS) || 120
  const rendered = table(rows, { termWidth, linkStyle: opts.link || 'auto', columns: opts.columns })
  console.log(rendered.text)

  if (!opts.noSummary) {
    console.log(
      '\n' +
        c.dim(
          `  ${counts.fetched} open on base · ${counts.team} from team · ` +
            `${counts.ready} need review · ${counts.drafts} draft · ` +
            `${counts.approved} approved · ${counts.mine} yours`
        )
    )
    if (!opts.ready && counts.ready) {
      console.log(c.dim(`  Narrow to what you can act on: `) + c.bold('ghpr --ready'))
    }
    if (rendered.linkStyle === 'short' && !opts.link) {
      console.log(
        c.dim('  Links shortened to protect the titles — widen the window or use ') +
          c.bold('--link full')
      )
    }
    console.log()
  }
}

try {
  main()
} catch (err) {
  const msg = err instanceof gh.GhError ? err.message : err.message || String(err)
  console.error(`${c.red('ghpr:')} ${msg}`)
  process.exit(1)
}
