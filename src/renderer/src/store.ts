import { createStore, produce } from 'solid-js/store'
import type { ContextUsage, HarnessEvent, ImageAttachment, Layout, Loaded, ModelOption, PermissionDecision, Tab, Usage } from '../../shared/types'

export type Item =
  | { kind: 'user'; id: string; text: string; images?: ImageAttachment[] }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; result?: string; is_error?: boolean }
  | { kind: 'permission'; id: string; tool: string; summary: string; input: Record<string, unknown>; rules: string[]; persistent: boolean; decision?: PermissionDecision }
  | { kind: 'done'; id: string; usage: Usage; is_error: boolean; stopped: boolean }
  | { kind: 'compact'; id: string; trigger: string; preTokens: number }
  | { kind: 'error'; id: string; text: string }

export type TabState = {
  items: Item[]
  busy: boolean
  live: boolean
  starting: boolean
  pendingPermission: string | null
  loaded?: Loaded
  context?: ContextUsage
  compactedAt?: number
  models: ModelOption[]
  status?: string
  unread: number
  projects: { root: string; name: string }[]
  pinnedProject: string | null
  paneOpen: boolean
  paneMode: 'dev' | 'git'
}

type State = {
  tabs: Tab[]
  groups: string[]
  activeId: string | null
  byTab: Record<string, TabState>
  devRunning: Record<string, boolean>
}

const [state, setState] = createStore<State>({ tabs: [], groups: [], activeId: null, byTab: {}, devRunning: {} })

let seq = 0
const nextId = () => `i${++seq}`

export const emptyTabState = (): TabState => ({
  items: [],
  busy: false,
  live: false,
  starting: false,
  pendingPermission: null,
  models: [],
  unread: 0,
  projects: [],
  pinnedProject: null,
  paneOpen: false,
  paneMode: 'dev',
})

export function setPane(tabId: string, patch: Partial<Pick<TabState, 'paneOpen' | 'paneMode'>>) {
  ensureTab(tabId)
  setState('byTab', tabId, patch)
}

export function setPinnedProject(tabId: string, root: string | null) {
  ensureTab(tabId)
  setState('byTab', tabId, 'pinnedProject', root)
}

export function setDevRunning(root: string, running: boolean) {
  setState('devRunning', root, running)
}

export function ensureTab(id: string) {
  if (!state.byTab[id]) setState('byTab', id, emptyTabState())
}

export function setLayout(layout: Layout) {
  setState('tabs', layout.tabs)
  setState('groups', layout.groups)
  for (const t of layout.tabs) ensureTab(t.id)
}

export function layout(): { ungrouped: Tab[]; groups: { name: string; tabs: Tab[] }[] } {
  const by = new Map<string, Tab[]>()
  for (const t of state.tabs) by.set(t.group, [...(by.get(t.group) ?? []), t])
  const names = [...state.groups]
  for (const g of by.keys()) if (g && !names.includes(g)) names.push(g)
  return { ungrouped: by.get('') ?? [], groups: names.map((name) => ({ name, tabs: by.get(name) ?? [] })) }
}

export function orderedTabs(): Tab[] {
  const l = layout()
  return [...l.ungrouped, ...l.groups.flatMap((g) => g.tabs)]
}

export function upsertTab(tab: Tab) {
  const i = state.tabs.findIndex((t) => t.id === tab.id)
  if (i >= 0) setState('tabs', i, tab)
  else setState('tabs', (tabs) => [...tabs, tab])
  ensureTab(tab.id)
}

export function removeTab(id: string) {
  setState('tabs', (tabs) => tabs.filter((t) => t.id !== id))
  setState(
    produce((s) => {
      delete s.byTab[id]
      if (s.activeId === id) s.activeId = s.tabs[0]?.id ?? null
    }),
  )
}

export function setActive(id: string | null) {
  setState('activeId', id)
  if (id) setState('byTab', id, 'unread', 0)
}

export function addUser(tabId: string, text: string) {
  ensureTab(tabId)
  setState('byTab', tabId, 'busy', true)
}

export function clearTranscript(tabId: string) {
  setState('byTab', tabId, 'items', [])
}

export function applyEvent(e: HarnessEvent) {
  ensureTab(e.tabId)
  const t = (fn: (s: TabState) => void) => setState('byTab', e.tabId, produce(fn))
  const push = (item: Item) =>
    t((s) => {
      s.items.push(item)
      if (state.activeId !== e.tabId) s.unread++
    })

  switch (e.type) {
    case 'resync':
      t((s) => {
        s.items = []
        s.pendingPermission = null
      })
      for (const ev of e.events) applyEvent({ ...ev, tabId: e.tabId })
      t((s) => {
        s.busy = e.busy
        const last = s.items.at(-1)
        if (last?.kind === 'assistant') last.streaming = false
      })
      break
    case 'user_echo':
      t((s) => s.items.push({ kind: 'user', id: nextId(), text: e.text, images: e.images }))
      break
    case 'history':
      t((s) => {
        if (s.items.length) return
        for (const h of e.items) {
          if (h.kind === 'user') s.items.push({ kind: 'user', id: nextId(), text: h.text, images: h.images })
          else if (h.kind === 'assistant') s.items.push({ kind: 'assistant', id: nextId(), text: h.text, streaming: false })
          else s.items.push({ kind: 'tool', id: h.id, name: h.name, input: h.input, result: h.result, is_error: h.is_error })
        }
        s.items.push({ kind: 'compact', id: nextId(), trigger: 'resumed', preTokens: 0 })
      })
      break
    case 'session_starting':
      t((s) => {
        s.starting = true
        s.live = true
      })
      break
    case 'loaded':
      t((s) => {
        s.loaded = e.loaded
        s.starting = false
        s.live = true
      })
      break
    case 'models':
      t((s) => (s.models = e.models))
      break
    case 'turn_start':
      t((s) => (s.busy = true))
      break
    case 'text_delta':
      t((s) => {
        const last = s.items.at(-1)
        if (last?.kind === 'assistant' && last.streaming) last.text += e.text
        else s.items.push({ kind: 'assistant', id: nextId(), text: e.text, streaming: true })
      })
      break
    case 'assistant_text':
      t((s) => {
        const last = s.items.at(-1)
        if (last?.kind === 'assistant' && last.streaming) {
          last.text = e.text
          last.streaming = false
        } else if (e.text.trim()) s.items.push({ kind: 'assistant', id: nextId(), text: e.text, streaming: false })
      })
      break
    case 'tool_use':
      push({ kind: 'tool', id: e.id, name: e.name, input: e.input })
      break
    case 'tool_result':
      t((s) => {
        const item = s.items.find((i) => i.kind === 'tool' && i.id === e.id)
        if (item?.kind === 'tool') {
          item.result = e.content
          item.is_error = e.is_error
        }
      })
      break
    case 'permission_request':
      push({ kind: 'permission', id: e.requestId, tool: e.tool, summary: e.summary, input: e.input, rules: e.rules, persistent: e.persistent })
      t((s) => (s.pendingPermission = e.requestId))
      break
    case 'permission_resolved':
      t((s) => {
        const p = s.items.find((i) => i.kind === 'permission' && i.id === e.requestId)
        if (p?.kind === 'permission') p.decision = e.decision
        if (s.pendingPermission === e.requestId) s.pendingPermission = null
      })
      break
    case 'turn_done':
      t((s) => {
        const last = s.items.at(-1)
        if (last?.kind === 'assistant') last.streaming = false
        s.busy = false
        s.items.push({ kind: 'done', id: nextId(), usage: e.usage, is_error: e.is_error, stopped: e.result === 'error_during_execution' })
        if (state.activeId !== e.tabId) s.unread++
      })
      break
    case 'compact':
      t((s) => (s.compactedAt = Date.now()))
      push({ kind: 'compact', id: nextId(), trigger: e.trigger, preTokens: e.preTokens })
      break
    case 'context':
      t((s) => (s.context = e.usage))
      break
    case 'project_touched':
      t((s) => {
        s.projects = [{ root: e.root, name: e.name }, ...s.projects.filter((p) => p.root !== e.root)]
      })
      break
    case 'reset':
      t((s) => {
        s.items = []
        s.pendingPermission = null
        s.busy = false
        s.context = undefined
        s.compactedAt = undefined
      })
      break
    case 'status':
      t((s) => (s.status = e.text))
      break
    case 'error':
      t((s) => {
        s.busy = false
        s.starting = false
      })
      push({ kind: 'error', id: nextId(), text: e.message })
      break
    case 'session_closed':
      t((s) => {
        s.live = false
        s.busy = false
        s.starting = false
      })
      break
  }
}

export { state }
