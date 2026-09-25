import * as pty from 'node-pty'
import { resolveShell } from '../shell'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const BUFFER_MAX = 200_000
const ANSI = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g

function killTree(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      return
    }
  }
}

type Entry = {
  proc: pty.IPty
  buffer: string
  running: boolean
  exitCode: number | null
  logFile?: string
}

export type PtyEvent = { type: 'data'; key: string; data: string } | { type: 'exit'; key: string; code: number }

export class PtyManager {
  private entries = new Map<string, Entry>()

  constructor(private emit: (e: PtyEvent) => void) {}

  running(key: string) {
    return this.entries.get(key)?.running ?? false
  }

  attach(key: string): { buffer: string; running: boolean; exitCode: number | null } {
    const e = this.entries.get(key)
    return e ? { buffer: e.buffer, running: e.running, exitCode: e.exitCode } : { buffer: '', running: false, exitCode: null }
  }

  start(key: string, opts: { shellCommand: string; cwd: string; cols: number; rows: number; logFile?: string; shell?: string }) {
    const existing = this.entries.get(key)
    if (existing?.running) return
    const sh = resolveShell(opts.shell)
    const proc = pty.spawn(sh.path, sh.args(opts.shellCommand), {
      name: 'xterm-256color',
      cols: Math.max(20, opts.cols || 80),
      rows: Math.max(5, opts.rows || 24),
      cwd: opts.cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG ?? 'en_US.UTF-8' },
    })
    const entry: Entry = { proc, buffer: '', running: true, exitCode: null, logFile: opts.logFile }
    if (opts.logFile) {
      mkdirSync(dirname(opts.logFile), { recursive: true })
      appendFileSync(opts.logFile, `\n=== ${new Date().toISOString()} ${opts.shellCommand} (cwd ${opts.cwd})\n`)
    }
    this.entries.set(key, entry)
    proc.onData((data) => {
      entry.buffer = (entry.buffer + data).slice(-BUFFER_MAX)
      if (entry.logFile) appendFileSync(entry.logFile, data.replace(ANSI, ''))
      this.emit({ type: 'data', key, data })
    })
    proc.onExit(({ exitCode }) => {
      entry.running = false
      entry.exitCode = exitCode
      this.emit({ type: 'exit', key, code: exitCode })
    })
  }

  write(key: string, data: string) {
    const e = this.entries.get(key)
    if (e?.running) e.proc.write(data)
  }

  resize(key: string, cols: number, rows: number) {
    const e = this.entries.get(key)
    if (!e?.running || cols <= 0 || rows <= 0) return
    try {
      e.proc.resize(cols, rows)
    } catch {
      return
    }
  }

  kill(key: string) {
    const e = this.entries.get(key)
    if (!e?.running) return
    killTree(e.proc.pid, 'SIGTERM')
    setTimeout(() => {
      if (e.running) killTree(e.proc.pid, 'SIGKILL')
    }, 2000)
  }

  killAll() {
    for (const e of this.entries.values()) if (e.running) killTree(e.proc.pid, 'SIGKILL')
  }
}
