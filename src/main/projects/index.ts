import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, isAbsolute, basename } from 'node:path'
import { shell } from 'electron'
import type { ClosetConfig, EditorId, ProjectInfo } from '../../shared/types'
import { configDir } from '../config'
import { which } from '../shell'
import { PtyManager, type PtyEvent } from './pty'
import { expandHome, projectName } from './resolve'

export const devKey = (root: string) => `${root}::dev`
export const gitKey = (root: string) => `${root}::git`

const EDITOR_CANDIDATES: { id: EditorId; bin: string; label: string }[] = [
  { id: 'code', bin: 'code', label: 'VS Code' },
  { id: 'cursor', bin: 'cursor', label: 'Cursor' },
  { id: 'zed', bin: 'zed', label: 'Zed' },
  { id: 'xcode', bin: 'xed', label: 'Xcode' },
  { id: 'idea', bin: 'idea', label: 'IntelliJ IDEA' },
  { id: 'webstorm', bin: 'webstorm', label: 'WebStorm' },
  { id: 'subl', bin: 'subl', label: 'Sublime Text' },
]

export class ProjectManager {
  readonly ptys: PtyManager
  private editors: { id: EditorId; label: string; path: string }[] | null = null

  constructor(
    private config: () => ClosetConfig,
    private saveConfig: (patch: Partial<ClosetConfig>) => void,
    emit: (e: PtyEvent) => void,
  ) {
    this.ptys = new PtyManager(emit)
  }

  detectDevCommand(root: string): string | null {
    const pkg = join(root, 'package.json')
    if (!existsSync(pkg)) return null
    try {
      const scripts = (JSON.parse(readFileSync(pkg, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {}
      const script = ['dev', 'start:dev', 'serve', 'start'].find((s) => scripts[s])
      if (!script) return null
      const runner = existsSync(join(root, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : existsSync(join(root, 'yarn.lock'))
          ? 'yarn'
          : existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))
            ? 'bun run'
            : 'npm run'
      return `${runner} ${script}`
    } catch {
      return null
    }
  }

  info(root: string): ProjectInfo {
    const override = this.config().projects?.[root]?.devCommand
    return {
      root,
      name: projectName(root),
      devCommand: override ?? this.detectDevCommand(root),
      devCommandSource: override ? 'override' : 'detected',
      devRunning: this.ptys.running(devKey(root)),
      gitRunning: this.ptys.running(gitKey(root)),
      devLog: this.logFile(root),
    }
  }

  setDevCommand(root: string, command: string | null) {
    const projects = { ...(this.config().projects ?? {}) }
    if (command) projects[root] = { ...(projects[root] ?? {}), devCommand: command }
    else if (projects[root]) delete projects[root].devCommand
    this.saveConfig({ projects })
  }

  logFile(root: string) {
    return join(configDir, 'logs', `${basename(root)}.dev.log`)
  }

  startDev(root: string, cols: number, rows: number): ProjectInfo {
    const cmd = this.info(root).devCommand
    if (cmd) this.ptys.start(devKey(root), { shellCommand: cmd, cwd: root, cols, rows, logFile: this.logFile(root), shell: this.config().shell })
    return this.info(root)
  }

  stopDev(root: string) {
    this.ptys.kill(devKey(root))
  }

  startGit(root: string, cols: number, rows: number): ProjectInfo {
    this.ptys.start(gitKey(root), { shellCommand: 'lazygit', cwd: root, cols, rows, shell: this.config().shell })
    return this.info(root)
  }

  stopGit(root: string) {
    this.ptys.kill(gitKey(root))
  }

  async listEditors() {
    if (this.editors) return this.editors
    const found: { id: EditorId; label: string; path: string }[] = []
    for (const c of EDITOR_CANDIDATES) {
      const p = await which(c.bin, this.config().shell)
      if (p) found.push({ id: c.id, label: c.label, path: p })
    }
    this.editors = found
    return found
  }

  async openInEditor(target: { root?: string; file?: string; line?: number; cwd?: string }): Promise<string | null> {
    const editors = await this.listEditors()
    const wanted = this.config().editor
    const editor = editors.find((e) => e.id === wanted) ?? editors[0]
    let file = target.file ? expandHome(target.file) : undefined
    if (file && !isAbsolute(file)) file = resolve(target.root ?? target.cwd ?? homedir(), file)
    if (file && !existsSync(file)) return `not found: ${file}`
    if (!editor) {
      await shell.openPath(file ?? target.root ?? homedir())
      return null
    }
    const args = editorArgs(editor.id, { root: target.root, file, line: target.line })
    spawn(editor.path, args, { detached: true, stdio: 'ignore' }).unref()
    return null
  }

  shutdown() {
    this.ptys.killAll()
  }
}

function editorArgs(id: EditorId, t: { root?: string; file?: string; line?: number }): string[] {
  const loc = t.file ? (t.line ? `${t.file}:${t.line}` : t.file) : null
  switch (id) {
    case 'code':
    case 'cursor':
      return loc ? [...(t.root ? [t.root] : []), '--goto', loc] : [t.root ?? '.']
    case 'zed':
      return loc ? [loc] : [t.root ?? '.']
    case 'xcode':
      return loc && t.line ? ['--line', String(t.line), t.file as string] : [t.file ?? t.root ?? '.']
    case 'idea':
    case 'webstorm':
      return loc && t.line ? ['--line', String(t.line), t.file as string] : [t.file ?? t.root ?? '.']
    case 'subl':
      return loc ? [loc] : [t.root ?? '.']
  }
}
