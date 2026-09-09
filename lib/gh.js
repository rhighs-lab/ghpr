'use strict'

const { execFileSync } = require('child_process')

class GhError extends Error {}

function gh(args, { allowFail = false } = {}) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    if (allowFail) return null

    if (err.code === 'ENOENT') {
      throw new GhError('the GitHub CLI (gh) is not on your PATH — install it from https://cli.github.com')
    }

    const stderr = (err.stderr || '').toString().trim()
    if (/auth login|not logged/i.test(stderr)) {
      throw new GhError('gh is not authenticated — run: gh auth login')
    }

    throw new GhError(`gh ${args.slice(0, 2).join(' ')} failed:\n${stderr || err.message}`)
  }
}

function ghJson(args, opts) {
  const out = gh(args, opts)
  if (out === null) return null
  try {
    return JSON.parse(out)
  } catch {
    throw new GhError(`gh returned output that is not JSON:\n${out.slice(0, 400)}`)
  }
}

/** Teams the authenticated user belongs to, as { org, slug } pairs. */
function myTeams() {
  const teams = ghJson(['api', 'user/teams', '--paginate'])
  return teams.map(t => ({ org: t.organization.login, slug: t.slug }))
}

/** Logins of every member of org/slug. */
function teamMembers(org, slug) {
  return ghJson(['api', `orgs/${org}/teams/${slug}/members`, '--paginate']).map(m => m.login)
}

function currentLogin() {
  return ghJson(['api', 'user']).login
}

const PR_FIELDS = [
  'number',
  'title',
  'author',
  'createdAt',
  'updatedAt',
  'isDraft',
  'reviewDecision',
  'url',
  'additions',
  'deletions',
  'reviewRequests'
].join(',')

function openPullRequests(repo, base, limit) {
  const args = ['pr', 'list', '-R', repo, '--state', 'open', '--limit', String(limit), '--json', PR_FIELDS]
  if (base) args.push('--base', base)
  return ghJson(args)
}

module.exports = { GhError, gh, ghJson, myTeams, teamMembers, currentLogin, openPullRequests }
