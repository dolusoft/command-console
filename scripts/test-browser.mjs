// Runs the browser tests with a hard time limit.
//
// Why this exists: on Windows, a page opened by Vitest Browser Mode
// occasionally fails its very first WebSocket connection to the Vitest server
// (Chromium logs `ERR_CONNECTION_TIMED_OUT`, os error 10060: the loopback SYN
// went unanswered for a second). The Vitest client reconnects two seconds
// later, but whoever already waited for the connection stayed bound to the
// dead socket, and the orchestrator waits for `response:prepare` without a
// timeout, so the run hung. patches/@vitest__browser@*.patch lets a reconnect
// wake those waiters, and the browser API listens on 127.0.0.1 so a dropped
// module request is saved by Chromium's backup connection (vitest.config.ts).
// This wrapper is the last net: a run that never connects at all still has no
// timeout inside Vitest.
//
// A run that hung or lost its connection is retried once; a run whose tests
// failed is not. Both limits can be overridden:
//   BROWSER_TEST_TIMEOUT_MS  per attempt, default 300000 (Query Table's
//                            measure: 53 files, 313 tests on Windows took
//                            ~80 s headless, over 200 s headed).
//   BROWSER_TEST_IDLE_MS     a run that reports every test (--reporter=dot,
//                            verbose or tap) and stays silent this long is
//                            taken as hung, default 60000. A hang shows as
//                            dots that stop; the slowest test takes ~2 s and
//                            a failing one at most its 15 s timeout, so
//                            waiting out the whole limit wasted minutes. Other
//                            reporters write per file or at the end (the
//                            default one does too, as its output is piped),
//                            so a slow failing file would look hung: they get
//                            only the per-attempt limit.
//   BROWSER_TEST_ATTEMPTS    default 2
//   BROWSER_TEST_PROJECT     Vitest projects to run, comma-separated, default
//                            "browser"
//
// A run that finds no browser spec passes (`--passWithNoTests`): the Vue
// package's browser specs arrive with the package.
//
// Without a terminal (an agent, a pipe, CI) the run is headless unless
// HEADLESS is set: nobody watches the page, and headed takes 2.5 times as long.
// Without a terminal and without a --reporter argument it reports with dot,
// so the run streams progress for the idle limit to watch.
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const attemptTimeoutMs = Number(process.env.BROWSER_TEST_TIMEOUT_MS) || 300_000
const idleTimeoutMs = Number(process.env.BROWSER_TEST_IDLE_MS) || 60_000
if (!process.stdout.isTTY && process.env.HEADLESS === undefined) {
  process.env.HEADLESS = '1'
}
const args = process.argv.slice(2)
const reporters = args.filter(arg => arg.startsWith('--reporter'))
if (!process.stdout.isTTY && reporters.length === 0) {
  args.push('--reporter=dot')
}
const streams = args.some(arg => /^--reporter=(dot|verbose|tap)$/.test(arg))
const maxAttempts = Number(process.env.BROWSER_TEST_ATTEMPTS) || 2
const projects = (process.env.BROWSER_TEST_PROJECT || 'browser')
  .split(',')
  .flatMap(name => ['--project', name.trim()])
const lostConnection =
  /Failed to connect to the browser session|The iframe "[^"\r\n]+" did not become ready within \d+ms|Failed to fetch dynamically imported module: http:\/\/(?:localhost|127\.0\.0\.1):\d+\//

const vitestBin = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs'
)

const killTree = child => {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore'
    })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

const runOnce = () =>
  new Promise(resolve => {
    const child = spawn(
      process.execPath,
      [vitestBin, 'run', '--passWithNoTests', ...projects, ...args],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        env: process.stdout.isTTY
          ? { ...process.env, FORCE_COLOR: '1' }
          : process.env
      }
    )
    let timedOut = false
    let idle = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, attemptTimeoutMs)
    let idleTimer
    const watchIdle = () => {
      if (!streams) {
        return
      }
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        idle = true
        killTree(child)
      }, idleTimeoutMs)
    }
    watchIdle()

    let tail = ''
    const forward = (stream, target) =>
      stream.on('data', chunk => {
        target.write(chunk)
        tail = (tail + chunk).slice(-65_536)
        watchIdle()
      })
    forward(child.stdout, process.stdout)
    forward(child.stderr, process.stderr)

    const onSignal = signal => () => {
      killTree(child)
      process.exit(signal === 'SIGINT' ? 130 : 143)
    }
    const sigint = onSignal('SIGINT')
    const sigterm = onSignal('SIGTERM')
    process.once('SIGINT', sigint)
    process.once('SIGTERM', sigterm)

    child.on('close', code => {
      clearTimeout(timer)
      clearTimeout(idleTimer)
      process.off('SIGINT', sigint)
      process.off('SIGTERM', sigterm)
      resolve({
        code: code ?? 1,
        timedOut,
        idle,
        lostConnection: lostConnection.test(tail)
      })
    })
  })

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = await runOnce()
  if (result.code === 0 && !result.timedOut && !result.idle) {
    process.exit(0)
  }

  const stalled = result.timedOut || result.idle || result.lostConnection
  if (!stalled) {
    process.exit(result.code)
  }

  const reason = result.idle
    ? `no output for ${idleTimeoutMs / 1000}s`
    : result.timedOut
      ? `no result within ${attemptTimeoutMs / 1000}s`
      : 'the browser lost its connection to Vitest'
  if (attempt < maxAttempts) {
    console.error(
      `\n[test:browser] attempt ${attempt}/${maxAttempts}: ${reason}; retrying.\n`
    )
  } else {
    console.error(
      `\n[test:browser] attempt ${attempt}/${maxAttempts}: ${reason}; giving up.\n`
    )
    process.exit(1)
  }
}
