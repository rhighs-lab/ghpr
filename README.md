# ghpr

Lists open pull requests authored by members of your GitHub team, as a table you
can scan for review work.

Zero dependencies. It shells out to the GitHub CLI, so it inherits whatever auth
`gh` already has.

## Install

```sh
cd ~/tools/team-prs
npm install -g .
```

## Use

```sh
ghpr                    # every open team PR on the default base branch
ghpr --ready            # only what you can act on now
ghpr --mine             # your own PRs
ghpr --base any         # ignore the base-branch filter
ghpr -t Kong/gateway    # a different team
ghpr --teams            # which teams you belong to
ghpr --json | jq .      # raw data
```

`--ready` means: not a draft, not authored by you, and not already approved.

`--help` lists every flag.

## Tracking responses

`--comments` shows review threads and PR-level comments in a table for each PR,
so you can see who owes a reply without opening anything.

```sh
ghpr --comments                 # threads on your own PRs
ghpr --comments --no-bots       # drop the changelog / luacheck bots
ghpr --comments -a tysoekong    # threads on someone else's PRs
ghpr --comments --resolved      # include the settled threads
ghpr --comments --notes 0       # threads only, no PR-level comments
ghpr --comments --json          # the same data, machine-readable
```

With no author filter it looks at your own PRs.

### Whose turn is it

Each open thread is classified by who spoke last, relative to the **PR author**,
so the reading stays honest on someone else's PR:

| On your PRs | On other people's |
| --- | --- |
| `needs you` — a reviewer replied and you have not | `needs review` — the author replied last |
| `waiting` — you replied last, still open | `needs author` — a reviewer replied last |

Threads sort with the actionable ones first, then oldest first, so the most
stalled item in each PR is at the top of its table.

### What each entry shows

The last comment's author, its age, the file and line, a reply count, an
`outdated` marker when the code moved, the first line of that comment, and a
link to it. The link text is the anchor fragment (`#discussion_r123`) because
that is what identifies the comment; `--link full` prints whole URLs. The
fragment is a real hyperlink, so it is clickable even though it is short.

PR-level comments and review bodies appear in the same table as the threads.
Your own comments are left out: they are not responses you are waiting on.
`--notes N` changes their cap, which is 3 by default.

## Defaults

`Kong/kong-ee`, base `aigw-master`, team `Kong/ai-gateway`.

Three ways to change them, in increasing permanence:

```sh
ghpr -r other/repo -b main -t Kong/gateway     # this run only
export TEAM_PRS_BASE=master                        # this shell
ghpr -b master --save                          # written to config
```

Config lives at `~/.config/team-prs/config.json`.

## Cache

Team rosters are cached for 24h under `~/.cache/team-prs`, since membership
rarely moves and the API call is the slow part. `--clear-cache` drops it.

PR data is never cached.

## Columns

| Column | Meaning |
| --- | --- |
| PR | number, as `#1234` |
| AUTHOR | GitHub login |
| STATE | draft / needs review / changes req. / approved / no reviews |
| SIZE | additions and deletions |
| AGE | days since the PR was opened; yellow past a week, red past a month |
| flags | `you` if you wrote it, `asked` if you or the team were requested |
| TITLE | truncated to the terminal width |
| LINK | the PR URL |

Colour is dropped automatically when stdout is not a TTY, or when `NO_COLOR` is
set.

## Links

The PR number is a real terminal hyperlink, so it is clickable in iTerm2,
WezTerm, Kitty, Ghostty and the VS Code terminal, at no cost in columns.
Terminals without OSC 8 support just print the number. Set
`TEAM_PRS_NO_HYPERLINK=1` to suppress the escapes.

The LINK column carries the URL as text, for copy-paste and for terminals that
linkify plain URLs themselves. A full URL costs 43 columns, which starves the
title on a narrow window, so the column adapts:

```sh
ghpr --link auto    # full URLs while titles keep 44+ columns, else short (default)
ghpr --link full    # always the whole URL
ghpr --link short   # always …/21675, still clickable
ghpr --link off     # no column; same as --no-link
```

When `auto` falls back to the short form it says so under the table.

Piped output is plain: no colour, no hyperlink escapes. `--json` is always
clean.
