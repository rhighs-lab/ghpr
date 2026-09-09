'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const DIR = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'team-prs')

function file(key) {
  return path.join(DIR, `${key.replace(/[^\w.-]+/g, '_')}.json`)
}

/** Reads a cached value, or null when absent, unreadable or older than ttlMs. */
function read(key, ttlMs) {
  try {
    const raw = JSON.parse(fs.readFileSync(file(key), 'utf8'))
    if (Date.now() - raw.at > ttlMs) return null
    return raw.value
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file(key), JSON.stringify({ at: Date.now(), value }))
  } catch {
    // A cold cache is slower, never wrong: a write failure is not worth failing on.
  }
}

function clear() {
  fs.rmSync(DIR, { recursive: true, force: true })
  return DIR
}

module.exports = { read, write, clear, DIR }
