import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

const cache = new Map<string, Promise<string | null>>()

function gitToplevel(dir: string): Promise<string | null> {
  let p = cache.get(dir)
  if (p) return p
  p = new Promise((done) => {
    execFile('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 5000 }, (err, stdout) => {
      done(err ? null : stdout.trim() || null)
    })
  })
  cache.set(dir, p)
  return p
}

export function expandHome(p: string): string {
  return p.startsWith('~/') || p === '~' ? resolve(homedir(), p.slice(2)) : p
}

export async function projectRootFor(path: string, cwd: string): Promise<string | null> {
  let abs = expandHome(path)
  if (!isAbsolute(abs)) abs = resolve(cwd, abs)
  let dir = abs
  try {
    if (!existsSync(dir)) dir = dirname(dir)
    if (!existsSync(dir)) return null
    if (!statSync(dir).isDirectory()) dir = dirname(dir)
  } catch {
    return null
  }
  return gitToplevel(dir)
}

export function projectName(root: string): string {
  return basename(root)
}

const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'cwd', 'directory']

export function candidatePaths(tool: string, input: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const k of PATH_KEYS) {
    const v = input[k]
    if (typeof v === 'string' && v) out.push(v)
  }
  if (tool === 'Bash' && typeof input.command === 'string') {
    for (const m of input.command.matchAll(/\bcd\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g)) out.push(m[1] ?? m[2] ?? m[3])
    for (const m of input.command.matchAll(/(?:^|[\s"'=(])((?:~|\/Users|\/home|\/opt|\/srv|\/var|\/tmp)\/[^\s"'|;&)>]+)/g)) out.push(m[1])
  }
  return out.map((p) => p.replace(/[:,.]+$/, '').replace(/:\d+(:\d+)?$/, ''))
}
