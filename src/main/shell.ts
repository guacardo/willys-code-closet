import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

export type ShellSpec = { path: string; args: (command: string) => string[] }

const CANDIDATES =
  process.platform === 'win32'
    ? [
        join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        process.env.ComSpec,
      ]
    : [process.env.SHELL, '/bin/zsh', '/bin/bash', '/usr/bin/fish', '/bin/sh']

export const detectedShell: string = CANDIDATES.find((s): s is string => !!s && existsSync(s)) ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh')

function argsFor(path: string): (command: string) => string[] {
  const name = basename(path).toLowerCase().replace(/\.exe$/, '')
  if (name === 'pwsh' || name === 'powershell') return (c) => ['-NoLogo', '-NoProfile', '-Command', c]
  if (name === 'cmd') return (c) => ['/d', '/c', c]
  return (c) => ['-lc', c]
}

export function resolveShell(configured?: string): ShellSpec {
  const path = configured && existsSync(configured) ? configured : detectedShell
  return { path, args: argsFor(path) }
}

export function which(bin: string, shell?: string): Promise<string | null> {
  const sh = resolveShell(shell)
  const probe = process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`
  return new Promise((done) => execFile(sh.path, sh.args(probe), (err, out) => done(err ? null : out.trim().split(/\r?\n/)[0] || null)))
}
