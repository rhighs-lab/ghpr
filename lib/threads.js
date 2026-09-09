'use strict'

const { ghJson } = require('./gh')

const THREADS_QUERY = `
query($owner:String!,$name:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      number
      title
      url
      reviewDecision
      reviewThreads(first:50, after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first:100){
            nodes{ author{login} body url createdAt }
          }
        }
      }
      comments(last:30){
        nodes{ author{login} body url createdAt }
      }
      reviews(last:30){
        nodes{ author{login} body url createdAt state }
      }
    }
  }
}`

const BOT_PATTERN = /\[bot\]$|^app\/|^github-actions$|^dependabot$|^codecov/i

const isBot = login => BOT_PATTERN.test(login || '')

/** First line of a comment body, stripped of markdown noise and collapsed. */
function gist(body) {
  return String(body || '')
    .replace(/```[\s\S]*?```/g, ' ⟨code⟩ ')
    .replace(/^\s*(?::\w+:|[*_>#-]+)\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fetches every review thread plus the top-level comments and review bodies for
 * one PR, and classifies each open thread by whose court the ball is in.
 *
 * The turn is relative to the PR author, not to the caller, so the same reading
 * holds on someone else's PR: `author` means the author owes a reply, `reviewer`
 * means the reviewers do. The caller decides how to label those.
 */
function fetchThreads(repo, number, prAuthor) {
  const [owner, name] = repo.split('/')

  let cursor = null
  let pr = null
  const rawThreads = []

  do {
    const args = [
      'api', 'graphql',
      '-f', `query=${THREADS_QUERY}`,
      '-F', `owner=${owner}`,
      '-F', `name=${name}`,
      '-F', `number=${number}`
    ]
    if (cursor) args.push('-F', `cursor=${cursor}`)

    const data = ghJson(args).data.repository.pullRequest
    pr = pr || data
    rawThreads.push(...data.reviewThreads.nodes)
    cursor = data.reviewThreads.pageInfo.hasNextPage ? data.reviewThreads.pageInfo.endCursor : null
  } while (cursor)

  const threads = rawThreads
    .map(t => {
      const comments = t.comments.nodes.filter(Boolean)
      if (!comments.length) return null

      const first = comments[0]
      const last = comments[comments.length - 1]
      const lastLogin = last.author ? last.author.login : 'ghost'

      let turn
      if (t.isResolved) turn = 'resolved'
      else if (lastLogin.toLowerCase() === String(prAuthor).toLowerCase()) turn = 'reviewer'
      else turn = 'author'

      return {
        turn,
        outdated: t.isOutdated,
        path: t.path,
        line: t.line || t.originalLine,
        replies: comments.length - 1,
        openedBy: first.author ? first.author.login : 'ghost',
        lastBy: lastLogin,
        lastAt: last.createdAt,
        gist: gist(last.body),
        url: last.url,
        bot: isBot(lastLogin)
      }
    })
    .filter(Boolean)

  // Review submissions carry a body only when the reviewer wrote one.
  const reviewNotes = (pr.reviews ? pr.reviews.nodes : [])
    .filter(r => r && r.body && r.body.trim())
    .map(r => ({
      kind: 'review',
      state: r.state,
      author: r.author ? r.author.login : 'ghost',
      at: r.createdAt,
      gist: gist(r.body),
      url: r.url,
      bot: isBot(r.author && r.author.login)
    }))

  const issueNotes = (pr.comments ? pr.comments.nodes : [])
    .filter(Boolean)
    .map(cm => ({
      kind: 'comment',
      author: cm.author ? cm.author.login : 'ghost',
      at: cm.createdAt,
      gist: gist(cm.body),
      url: cm.url,
      bot: isBot(cm.author && cm.author.login)
    }))

  const notes = [...reviewNotes, ...issueNotes].sort((a, b) => b.at.localeCompare(a.at))

  return { number: pr.number, title: pr.title, url: pr.url, threads, notes }
}

module.exports = { fetchThreads, isBot, gist }
