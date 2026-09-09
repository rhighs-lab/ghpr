'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'team-prs',
  'config.json'
)

const DEFAULTS = {
  repo: 'Kong/kong-ee',
  base: 'aigw-master',
  team: 'Kong/ai-gateway',
  limit: 200
}

function load() {
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    // No config file is the normal case; the defaults stand.
  }

  const env = {}
  if (process.env.TEAM_PRS_REPO) env.repo = process.env.TEAM_PRS_REPO
  if (process.env.TEAM_PRS_BASE) env.base = process.env.TEAM_PRS_BASE
  if (process.env.TEAM_PRS_TEAM) env.team = process.env.TEAM_PRS_TEAM

  return { ...DEFAULTS, ...stored, ...env }
}

function save(patch) {
  const merged = { ...load(), ...patch }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2) + '\n')
  return { file: FILE, config: merged }
}

module.exports = { load, save, FILE, DEFAULTS }
