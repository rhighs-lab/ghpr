# ghpr

`ghpr` lists open pull requests from a GitHub team and shows what is ready for review. It uses your existing [GitHub CLI](https://cli.github.com/) login.

## Install

You need Git, GitHub CLI, and Node.js 18 or newer. Authenticate first with `gh auth login`, then clone and install:

```sh
git clone https://github.com/rhighs-lab/ghpr.git ~/.local/share/ghpr
~/.local/share/ghpr/install.sh
```

The installer links `ghpr` into `~/.local/bin`. To update it later:

```sh
git -C ~/.local/share/ghpr pull --ff-only
```

## Commands

| Command | What it does |
| --- | --- |
| `ghpr` | List open team PRs on the default base branch |
| `ghpr --ready` | Show PRs you can review now |
| `ghpr --mine` | Show your PRs |
| `ghpr --requested ` | Show PRs you've been requested to review |
| `ghpr --comments` | Show review threads on your PRs |
| `ghpr --comments -a LOGIN` | Show threads on another author's PRs |
| `ghpr --comments --no-bots` | Hide bot comments and threads |
| `ghpr --comments --resolved` | Include resolved threads |
| `ghpr --comments --notes N` | Limit PR-level comments; use `0` for none |
| `ghpr --repo OWNER/REPO` | Use another repository |
| `ghpr --base BRANCH` | Filter by base branch; use `any` for all |
| `ghpr --team ORG/TEAM` | Use another GitHub team |
| `ghpr --teams` | List teams you belong to |
| `ghpr --author LOGIN` | Filter by author; repeat for more authors |
| `ghpr --sort created\|updated\|size\|age` | Change the sort order |
| `ghpr --limit N` | Limit the number of open PRs fetched |
| `ghpr --link full\|short\|off\|auto` | Choose how links are displayed |
| `ghpr --json` | Print JSON |
| `ghpr --no-summary` | Hide the counts summary |
| `ghpr --save` | Save the current repo, base, and team |
| `ghpr --clear-cache` | Clear the cached team roster |
| `ghpr --help` | Show every option |

`--ready` excludes drafts, your own PRs, and approved PRs. In comment view, actionable threads appear first.

## Configuration

The defaults are `Kong/kong-ee`, base `aigw-master`, and team `Kong/ai-gateway`.

Override them with flags, set `TEAM_PRS_REPO`, `TEAM_PRS_BASE`, and `TEAM_PRS_TEAM` in your shell, or pass `--save` to write `~/.config/team-prs/config.json`.

Team rosters are cached for 24 hours in `~/.cache/team-prs`; PR data is not cached.
