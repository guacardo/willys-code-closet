import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

function importsOf(file: string): string[] {
  try {
    const text = readFileSync(file, 'utf8')
    const out: string[] = []
    for (const m of text.matchAll(/^@(\S+)\s*$/gm)) {
      const raw = m[1]
      out.push(raw.startsWith('~') ? join(homedir(), raw.slice(1)) : resolve(dirname(file), raw))
    }
    return out
  } catch {
    return []
  }
}

export function claudeMdFiles(cwd: string): { path: string; bytes: number }[] {
  const seen = new Set<string>()
  const queue: string[] = [join(homedir(), '.claude', 'CLAUDE.md')]
  const chain: string[] = []
  let dir = resolve(cwd)
  while (true) {
    chain.unshift(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const d of chain) queue.push(join(d, 'CLAUDE.md'), join(d, '.claude', 'CLAUDE.md'), join(d, 'CLAUDE.local.md'))

  const out: { path: string; bytes: number }[] = []
  while (queue.length) {
    const f = queue.shift() as string
    if (seen.has(f) || !existsSync(f)) continue
    seen.add(f)
    try {
      out.push({ path: f, bytes: statSync(f).size })
    } catch {
      continue
    }
    queue.push(...importsOf(f))
  }
  return out
}

export function memoryIndex(cwd: string): { path: string; entries: number } | undefined {
  const slug = resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')
  const file = join(homedir(), '.claude', 'projects', slug, 'memory', 'MEMORY.md')
  if (!existsSync(file)) return undefined
  try {
    const entries = readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('- ')).length
    return { path: file, entries }
  } catch {
    return undefined
  }
}
