import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { ClosetConfig, HarnessEvent, ImageAttachment, Layout, PermissionDecision, Tab } from '../../shared/types'
import { loadLayout, saveLayout } from '../config'
import { TabSession } from './tab'

export class TabManager {
  private tabs: Tab[]
  private groups: string[]
  private sessions = new Map<string, TabSession>()

  constructor(
    private config: () => ClosetConfig,
    private emit: (e: HarnessEvent) => void,
  ) {
    const saved = loadLayout()
    this.tabs = saved.tabs
    this.groups = saved.groups
    for (const t of this.tabs) this.ensureGroup(t.group)
  }

  layout(): Layout {
    return { tabs: this.tabs, groups: this.groups }
  }

  create(init: { cwd?: string; name?: string; group?: string }): Tab {
    const cfg = this.config()
    const cwd = init.cwd ?? cfg.defaultCwd
    const tab: Tab = {
      id: randomUUID(),
      name: init.name ?? basename(cwd),
      group: init.group ?? '',
      cwd,
      model: cfg.defaultModel,
      permissionMode: cfg.defaultPermissionMode,
      createdAt: new Date().toISOString(),
    }
    this.ensureGroup(tab.group)
    const last = this.tabs.findLastIndex((t) => t.group === tab.group)
    this.tabs.splice(last < 0 ? this.tabs.length : last + 1, 0, tab)
    this.persist()
    return tab
  }

  get(id: string): Tab {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) throw new Error(`no tab ${id}`)
    return tab
  }

  async update(id: string, patch: Partial<Pick<Tab, 'name' | 'group' | 'model' | 'permissionMode' | 'baseURL'>>): Promise<Tab> {
    const tab = this.get(id)
    const session = this.sessions.get(id)
    if ('model' in patch && patch.model !== tab.model) await session?.setModel(patch.model)
    if (patch.permissionMode && patch.permissionMode !== tab.permissionMode) await session?.setPermissionMode(patch.permissionMode)
    Object.assign(tab, patch)
    this.ensureGroup(tab.group)
    this.persist()
    return tab
  }

  moveTab(id: string, group: string, beforeId: string | null): Layout {
    const tab = this.get(id)
    this.tabs = this.tabs.filter((t) => t.id !== id)
    tab.group = group
    this.ensureGroup(group)
    let i = beforeId ? this.tabs.findIndex((t) => t.id === beforeId) : -1
    if (i < 0) {
      const last = this.tabs.findLastIndex((t) => t.group === group)
      i = last < 0 ? this.tabs.length : last + 1
    }
    this.tabs.splice(i, 0, tab)
    this.persist()
    return this.layout()
  }

  createGroup(name: string): Layout {
    this.ensureGroup(name)
    this.persist()
    return this.layout()
  }

  renameGroup(from: string, to: string): Layout {
    if (!to || from === to) return this.layout()
    for (const t of this.tabs) if (t.group === from) t.group = to
    this.groups = this.groups.filter((g) => g !== from)
    this.ensureGroup(to)
    this.persist()
    return this.layout()
  }

  removeGroup(name: string): Layout {
    for (const t of this.tabs) if (t.group === name) t.group = ''
    this.groups = this.groups.filter((g) => g !== name)
    this.persist()
    return this.layout()
  }

  reorderGroups(names: string[]): Layout {
    this.groups = [...new Set([...names, ...this.groups])]
    this.persist()
    return this.layout()
  }

  open(id: string) {
    const s = this.session(id)
    s.resync()
    s.start()
  }

  send(id: string, text: string, images: ImageAttachment[] = []) {
    this.session(id).send(text, images)
  }

  snapshot(id: string) {
    return this.sessions.get(id)?.snapshot() ?? { events: [], busy: false, pending: [] }
  }

  cancel(id: string) {
    return this.sessions.get(id)?.cancel()
  }

  permission(id: string, requestId: string, decision: PermissionDecision) {
    this.sessions.get(id)?.resolvePermission(requestId, decision)
  }

  close(id: string, remove: boolean) {
    this.sessions.get(id)?.close()
    this.sessions.delete(id)
    if (remove) {
      this.tabs = this.tabs.filter((t) => t.id !== id)
      this.persist()
    }
  }

  setProjectResolver(_fn: (tabId: string) => string[]) {}

  projectRoots(id: string): string[] {
    return this.sessions.get(id)?.projectRoots() ?? []
  }

  closeAll() {
    for (const s of this.sessions.values()) s.close()
    this.sessions.clear()
  }

  private ensureGroup(name: string) {
    if (name && !this.groups.includes(name)) this.groups.push(name)
  }

  private session(id: string): TabSession {
    let s = this.sessions.get(id)
    if (s) return s
    const tab = this.get(id)
    s = new TabSession(
      tab,
      (e) => this.emit({ ...e, tabId: id }),
      () => this.persist(),
    )
    this.sessions.set(id, s)
    return s
  }

  private persist() {
    saveLayout(this.layout())
  }
}
