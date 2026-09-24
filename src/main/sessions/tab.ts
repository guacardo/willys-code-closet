import {
  getSessionMessages,
  query,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type PermissionResult,
  type PermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import type { ContextUsage, HistoryItem, ImageAttachment, Loaded, PermissionDecision, Tab, TabEvent } from '../../shared/types'
import { Inbox } from './inbox'
import { claudeMdFiles, memoryIndex } from './loaded'
import { candidatePaths, projectName, projectRootFor } from '../projects/resolve'

type Emit = (e: TabEvent) => void

export class TabSession {
  private inbox = new Inbox<SDKUserMessage>()
  private q: Query | null = null
  private pending = new Map<string, (d: PermissionDecision) => void>()
  private alwaysAllow = new Set<string>()
  private streaming = ''
  private stopped = false
  private lastUser: { text: string; images: ImageAttachment[] } | null = null
  private turnsCompleted = 0
  private historyLoaded = false
  private suppressNextResult = false
  private projects: string[] = []

  projectRoots() {
    return this.projects
  }

  private touchProject(root: string) {
    const i = this.projects.indexOf(root)
    if (i === 0) return
    if (i > 0) this.projects.splice(i, 1)
    this.projects.unshift(root)
    this.emit({ type: 'project_touched', root, name: projectName(root) })
  }

  private async trackPaths(tool: string, input: Record<string, unknown>) {
    const seen = new Set<string>()
    for (const p of candidatePaths(tool, input)) {
      const root = await projectRootFor(p, this.tab.cwd)
      if (root && !seen.has(root)) {
        seen.add(root)
        this.touchProject(root)
      }
    }
  }

  async refreshContext() {
    const q = this.q
    if (!q) return
    try {
      const u = await q.getContextUsage({ detail: 'full' })
      if (this.q !== q) return
      this.emit({
        type: 'context',
        usage: {
          model: u.model,
          totalTokens: u.totalTokens,
          maxTokens: u.maxTokens,
          percentage: u.percentage,
          categories: u.categories.map((c) => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
          memoryFiles: u.memoryFiles,
          mcpTools: u.mcpTools,
          agents: (u.agents ?? []).map((a) => ({ name: a.agentType, source: a.source, tokens: a.tokens })),
          skills: (u.skills?.skillFrontmatter ?? []).map((s) => ({ name: s.name, source: s.source, tokens: s.tokens })),
        },
      })
    } catch {
      return
    }
  }

  private async loadHistory(sessionId: string) {
    this.historyLoaded = true
    try {
      const msgs = await getSessionMessages(sessionId, { dir: this.tab.cwd })
      const items = historyItems(msgs.map((m) => ({ type: m.type, parent: m.parent_tool_use_id, message: m.message })))
      if (items.length) this.emit({ type: 'history', items })
    } catch {
      return
    }
  }

  private log: TabEvent[] = []
  private pendingRequests = new Map<string, Extract<TabEvent, { type: 'permission_request' }>>()
  private busy = false

  constructor(
    public tab: Tab,
    private emitRaw: Emit,
    private onSessionId: (id: string) => void,
  ) {}

  private emit(e: TabEvent) {
    switch (e.type) {
      case 'loaded':
      case 'models':
      case 'context':
        this.log = this.log.filter((x) => x.type !== e.type)
        this.log.unshift(e)
        break
      case 'reset':
        this.log = this.log.filter((x) => x.type === 'loaded' || x.type === 'models')
        this.pendingRequests.clear()
        break
      case 'history':
        this.log.unshift(e)
        break
      case 'turn_start':
        this.busy = true
        this.log.push(e)
        break
      case 'turn_done':
      case 'error':
      case 'session_closed':
        this.busy = false
        this.log.push(e)
        break
      case 'permission_request':
        this.pendingRequests.set(e.requestId, e)
        this.log.push(e)
        break
      case 'permission_resolved':
        this.pendingRequests.delete(e.requestId)
        this.log.push(e)
        break
      case 'assistant_text':
      case 'tool_use':
      case 'tool_result':
      case 'compact':
      case 'user_echo':
      case 'project_touched':
        this.log.push(e)
        break
      default:
        break
    }
    this.emitRaw(e)
  }

  resync() {
    this.emitRaw({ type: 'resync', events: this.log, busy: this.busy })
  }

  get running() {
    return this.q !== null && !this.stopped
  }

  start() {
    if (this.q) return
    const options: Options = {
      cwd: this.tab.cwd,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      includePartialMessages: true,
      permissionMode: this.tab.permissionMode,
      canUseTool: (name, input, opts) => this.canUseTool(name, input, opts.signal, opts.suggestions ?? []),
      stderr: (data) => {
        if (data.trim()) this.emit({ type: 'status', text: data.trim().slice(0, 500) })
      },
    }
    if (this.tab.model) options.model = this.tab.model
    if (this.tab.sessionId) {
      options.resume = this.tab.sessionId
      if (!this.historyLoaded) void this.loadHistory(this.tab.sessionId)
    }
    if (this.tab.baseURL) options.env = { ...process.env, ANTHROPIC_BASE_URL: this.tab.baseURL }

    this.emit({ type: 'session_starting' })
    void projectRootFor(this.tab.cwd, this.tab.cwd).then((root) => root && this.touchProject(root))
    this.q = query({ prompt: this.inbox, options })
    void this.pump(this.q)
    void this.preload(this.q)
  }

  private async preload(q: Query) {
    try {
      const init = await q.initializationResult()
      if (this.q !== q) return
      const account = init.account
      const subscription = !!account.subscriptionType || account.tokenSource === 'oauth' || account.apiKeySource === 'none'
      this.emit({
        type: 'loaded',
        loaded: {
          partial: true,
          claudeCodeVersion: '',
          model: this.tab.model ?? init.models[0]?.value ?? '',
          cwd: this.tab.cwd,
          sessionId: this.tab.sessionId ?? '',
          apiKeySource: account.apiKeySource ?? account.tokenSource ?? 'unknown',
          permissionMode: this.tab.permissionMode,
          tools: [],
          mcpServers: [],
          slashCommands: init.commands.map((c) => c.name),
          skills: [],
          agents: init.agents.map((a) => a.name),
          plugins: [],
          account: { email: account.email, organization: account.organization, subscriptionType: account.subscriptionType },
          subscription,
          claudeMdFiles: claudeMdFiles(this.tab.cwd),
          memoryIndex: memoryIndex(this.tab.cwd),
        },
      })
      this.emit({
        type: 'models',
        models: init.models.map((m) => ({ id: m.value, name: m.displayName, resolved: m.resolvedModel, description: m.description })),
      })
      this.account = account
    } catch {
      return
    }
  }

  private account: { email?: string; organization?: string; subscriptionType?: string; tokenSource?: string; apiKeySource?: string } = {}

  send(text: string, images: ImageAttachment[] = []) {
    this.start()
    this.lastUser = { text, images }
    this.streaming = ''
    this.emit({ type: 'user_echo', text, images: images.length ? images : undefined })
    this.emit({ type: 'turn_start' })
    const content = images.length
      ? [
          ...images.map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.media_type, data: im.data } })),
          { type: 'text' as const, text },
        ]
      : text
    this.inbox.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.tab.sessionId ?? '',
    })
  }

  async cancel() {
    for (const [id, resolve] of this.pending) {
      resolve('deny')
      this.emit({ type: 'permission_resolved', requestId: id, decision: 'deny' })
    }
    this.pending.clear()
    await this.q?.interrupt().catch(() => undefined)
  }

  resolvePermission(requestId: string, decision: PermissionDecision) {
    const fn = this.pending.get(requestId)
    if (!fn) return
    this.pending.delete(requestId)
    fn(decision)
    this.emit({ type: 'permission_resolved', requestId, decision })
  }

  async setModel(model?: string) {
    this.tab.model = model
    await this.q?.setModel(model)
  }

  async setPermissionMode(mode: Tab['permissionMode']) {
    this.tab.permissionMode = mode
    await this.q?.setPermissionMode(mode)
  }

  close() {
    this.stopped = true
    this.inbox.close()
    this.q?.close()
    this.q = null
    this.emit({ type: 'session_closed' })
  }

  private async canUseTool(
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    suggestions: PermissionUpdate[],
  ): Promise<PermissionResult> {
    if (this.alwaysAllow.has(name)) return { behavior: 'allow', updatedInput: input }
    const requestId = randomUUID()
    const rules = suggestions.flatMap((s) =>
      s.type === 'addRules' || s.type === 'replaceRules'
        ? s.rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))
        : [],
    )
    const persistent = suggestions.some((s) => s.destination !== 'session')
    const decision = await new Promise<PermissionDecision>((resolve) => {
      this.pending.set(requestId, resolve)
      signal.addEventListener('abort', () => this.resolvePermission(requestId, 'deny'), { once: true })
      this.emit({ type: 'permission_request', requestId, tool: name, summary: summarize(name, input), input, rules, persistent })
    })
    if (decision === 'deny') return { behavior: 'deny', message: 'User denied this tool call in Code Closet' }
    if (decision === 'always') {
      if (suggestions.length) return { behavior: 'allow', updatedInput: input, updatedPermissions: suggestions }
      this.alwaysAllow.add(name)
    }
    return { behavior: 'allow', updatedInput: input }
  }

  private async pump(q: Query) {
    try {
      for await (const msg of q) this.handle(msg)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (this.stopped) return
      if (this.tab.sessionId && isMissingSession(message)) {
        this.restartFresh()
        return
      }
      this.emit({ type: 'error', message })
    } finally {
      if (this.q === q) {
        this.q = null
        if (!this.stopped) this.emit({ type: 'session_closed' })
      }
    }
  }

  private restartFresh() {
    this.q?.close()
    this.q = null
    this.tab.sessionId = undefined
    this.onSessionId('')
    this.inbox = new Inbox<SDKUserMessage>()
    this.emit({ type: 'status', text: 'Previous session was never saved; started a fresh one.' })
    const replay = this.lastUser
    this.start()
    if (replay) this.send(replay.text, replay.images)
  }

  private handle(msg: SDKMessage) {
    if ((msg.type === 'assistant' || msg.type === 'result') && msg.session_id && msg.session_id !== this.tab.sessionId) {
      this.tab.sessionId = msg.session_id
      this.onSessionId(msg.session_id)
    }
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          const loaded: Loaded = {
            claudeCodeVersion: msg.claude_code_version,
            model: msg.model,
            cwd: msg.cwd,
            sessionId: msg.session_id,
            apiKeySource: msg.apiKeySource,
            permissionMode: msg.permissionMode,
            tools: msg.tools,
            mcpServers: msg.mcp_servers.map((s) => ({ name: s.name, status: s.status })),
            slashCommands: msg.slash_commands,
            skills: msg.skills,
            agents: msg.agents ?? [],
            plugins: msg.plugins.map((p) => ({ name: p.name, version: p.version })),
            account: { email: this.account.email, organization: this.account.organization, subscriptionType: this.account.subscriptionType },
            subscription: msg.apiKeySource === 'none' || msg.apiKeySource === 'oauth' || !!this.account.subscriptionType,
            claudeMdFiles: claudeMdFiles(msg.cwd),
            memoryIndex: memoryIndex(msg.cwd),
          }
          this.emit({ type: 'loaded', loaded })
          void this.refreshContext()
        } else if (msg.subtype === 'compact_boundary') {
          this.emit({ type: 'compact', trigger: msg.compact_metadata.trigger, preTokens: msg.compact_metadata.pre_tokens })
        } else if (msg.subtype === 'status' && msg.status) {
          this.emit({ type: 'status', text: String(msg.status) })
        }
        return
      case 'stream_event': {
        if (msg.parent_tool_use_id) return
        const ev = msg.event
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          this.streaming += ev.delta.text
          this.emit({ type: 'text_delta', text: ev.delta.text })
        }
        return
      }
      case 'conversation_reset': {
        this.tab.sessionId = undefined
        this.onSessionId('')
        this.turnsCompleted = 0
        this.suppressNextResult = true
        this.emit({ type: 'reset', trigger: msg.trigger ?? 'clear' })
        return
      }
      case 'assistant': {
        if (msg.parent_tool_use_id) return
        if (msg.context_usage) this.emit({ type: 'context', usage: contextFromMessage(msg.context_usage) })
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            this.emit({ type: 'assistant_text', text: block.text })
            this.streaming = ''
          } else if (block.type === 'tool_use') {
            this.emit({ type: 'tool_use', id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> })
            void this.trackPaths(block.name, (block.input ?? {}) as Record<string, unknown>)
          }
        }
        return
      }
      case 'user': {
        if (msg.parent_tool_use_id) return
        const content = msg.message.content
        if (!Array.isArray(content)) return
        for (const block of content) {
          if (block.type === 'tool_result') {
            const text =
              typeof block.content === 'string'
                ? block.content
                : (block.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
            this.emit({ type: 'tool_result', id: block.tool_use_id, content: text, is_error: block.is_error ?? false })
          }
        }
        return
      }
      case 'result': {
        if (this.suppressNextResult) {
          this.suppressNextResult = false
          this.busy = false
          void this.refreshContext()
          return
        }
        if (msg.subtype !== 'success' && msg.errors.some(isMissingSession) && this.turnsCompleted === 0) return
        this.turnsCompleted++
        void this.refreshContext()
        const u = msg.usage
        this.emit({
          type: 'turn_done',
          is_error: msg.is_error,
          result: msg.subtype === 'success' ? msg.result : msg.subtype,
          usage: {
            input: u.input_tokens,
            output: u.output_tokens,
            cacheRead: u.cache_read_input_tokens ?? 0,
            costUsd: msg.total_cost_usd,
            turns: msg.num_turns,
            durationMs: msg.duration_ms,
          },
        })
        return
      }
      default:
        return
    }
  }
}

type StoredBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content?: string | { type: string; text?: string }[]; is_error?: boolean }
  | { type: string }

export function historyItems(msgs: { type: string; parent: string | null; message: unknown }[]): HistoryItem[] {
  const items: HistoryItem[] = []
  const tools = new Map<string, Extract<HistoryItem, { kind: 'tool' }>>()
  for (const m of msgs) {
    if (m.parent || (m.type !== 'user' && m.type !== 'assistant')) continue
    const message = m.message as { role?: string; content?: string | StoredBlock[] } | undefined
    const content = message?.content
    if (content === undefined) continue
    if (typeof content === 'string') {
      if (content.trim()) items.push({ kind: m.type as 'user' | 'assistant', text: content })
      continue
    }
    const images: ImageAttachment[] = []
    for (const block of content) {
      if (block.type === 'image' && m.type === 'user') {
        const src = (block as { source?: { type?: string; media_type?: ImageAttachment['media_type']; data?: string } }).source
        if (src?.type === 'base64' && src.data && src.media_type) images.push({ media_type: src.media_type, data: src.data })
      } else if (block.type === 'text') {
        const text = (block as { text: string }).text
        if (text.trim() || images.length) {
          items.push(m.type === 'user' ? { kind: 'user', text, images: images.length ? images.splice(0) : undefined } : { kind: 'assistant', text })
        }
      } else if (block.type === 'tool_use') {
        const b = block as { id: string; name: string; input?: Record<string, unknown> }
        const item: Extract<HistoryItem, { kind: 'tool' }> = { kind: 'tool', id: b.id, name: b.name, input: b.input ?? {} }
        tools.set(b.id, item)
        items.push(item)
      } else if (block.type === 'tool_result') {
        const b = block as { tool_use_id: string; content?: string | { type: string; text?: string }[]; is_error?: boolean }
        const target = tools.get(b.tool_use_id)
        if (!target) continue
        target.result =
          typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text ?? `[${c.type}]`).join('\n')
        target.is_error = b.is_error ?? false
      }
    }
    if (images.length) items.push({ kind: 'user', text: '', images: images.splice(0) })
  }
  return items
}

function contextFromMessage(u: NonNullable<Extract<SDKMessage, { type: 'assistant' }>['context_usage']>): ContextUsage {
  return {
    model: u.model,
    totalTokens: u.total_tokens,
    maxTokens: u.raw_max_tokens,
    percentage: u.percentage,
    categories: u.categories.map((c) => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    memoryFiles: u.memory_files,
    mcpTools: u.mcp_tools.map((m) => ({ name: m.name, serverName: m.server_name, tokens: m.tokens })),
    agents: u.agents.map((a) => ({ name: a.agent_type, source: a.source, tokens: a.tokens })),
    skills: (u.skills ?? []).map((s) => ({ name: s.name, source: s.source, tokens: s.tokens })),
  }
}

function isMissingSession(text: string): boolean {
  return /No conversation found with session ID/i.test(text)
}

function summarize(name: string, input: Record<string, unknown>): string {
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 200 ? s.slice(0, 200) + '…' : s
}
