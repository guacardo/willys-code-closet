export type PermissionDecision = 'allow' | 'always' | 'deny'
export type PermissionMode = 'auto' | 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

export type Tab = {
  id: string
  name: string
  group: string
  cwd: string
  sessionId?: string
  model?: string
  baseURL?: string
  permissionMode: PermissionMode
  createdAt: string
}

export type Layout = { tabs: Tab[]; groups: string[] }

export type EditorId = 'code' | 'cursor' | 'zed' | 'xcode' | 'idea' | 'webstorm' | 'subl'

export type ClosetConfig = {
  defaultCwd: string
  defaultModel?: string
  defaultPermissionMode: PermissionMode
  editor?: EditorId
  projects?: Record<string, { devCommand?: string }>
  voice?: { serverPath?: string; modelPath?: string; autoSend?: boolean }
}

export type VoiceStatus = {
  server: string | null
  model: string | null
  modelSizeMb: number | null
  running: boolean
  downloading: string | null
  micGranted: boolean | null
  modelsDir: string
}

export type VoiceEvent =
  | { type: 'progress'; name: string; received: number; total: number; done?: boolean }
  | { type: 'server'; running: boolean }

export type ProjectInfo = {
  root: string
  name: string
  devCommand: string | null
  devCommandSource: 'detected' | 'override'
  devRunning: boolean
  gitRunning: boolean
  devLog: string
}

export type PtyAttach = { buffer: string; running: boolean; exitCode: number | null }
export type PtyEvent = { type: 'data'; key: string; data: string } | { type: 'exit'; key: string; code: number }

export type ModelOption = { id: string; name: string; resolved?: string; description?: string }

export type Loaded = {
  claudeCodeVersion: string
  model: string
  cwd: string
  sessionId: string
  apiKeySource: string
  permissionMode: string
  tools: string[]
  mcpServers: { name: string; status: string }[]
  slashCommands: string[]
  skills: string[]
  agents: string[]
  plugins: { name: string; version?: string }[]
  account?: { email?: string; organization?: string; subscriptionType?: string }
  subscription: boolean
  partial?: boolean
  claudeMdFiles: { path: string; bytes: number }[]
  memoryIndex?: { path: string; entries: number }
}

export type ContextUsage = {
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  categories: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  memoryFiles: { path: string; type: string; tokens: number }[]
  mcpTools: { name: string; serverName: string; tokens: number }[]
  agents: { name: string; source: string; tokens: number }[]
  skills: { name: string; source: string; tokens: number }[]
}

export type Usage = { input: number; output: number; cacheRead: number; costUsd: number; turns: number; durationMs: number }

export type ImageAttachment = { media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string; name?: string }

export type HistoryItem =
  | { kind: 'user'; text: string; images?: ImageAttachment[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; result?: string; is_error?: boolean }

export type TabEvent =
  | { type: 'session_starting' }
  | { type: 'history'; items: HistoryItem[] }
  | { type: 'loaded'; loaded: Loaded }
  | { type: 'models'; models: ModelOption[] }
  | { type: 'turn_start' }
  | { type: 'user_echo'; text: string; images?: ImageAttachment[] }
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; is_error: boolean }
  | { type: 'permission_request'; requestId: string; tool: string; summary: string; input: Record<string, unknown>; rules: string[]; persistent: boolean }
  | { type: 'permission_resolved'; requestId: string; decision: PermissionDecision }
  | { type: 'turn_done'; usage: Usage; is_error: boolean; result: string }
  | { type: 'compact'; trigger: string; preTokens: number }
  | { type: 'context'; usage: ContextUsage }
  | { type: 'reset'; trigger: string }
  | { type: 'project_touched'; root: string; name: string }
  | { type: 'status'; text: string }
  | { type: 'error'; message: string }
  | { type: 'session_closed' }
  | { type: 'resync'; events: TabEvent[]; busy: boolean }

export type HarnessEvent = TabEvent & { tabId: string }

export type ClosetApi = {
  getLayout(): Promise<Layout>
  moveTab(id: string, group: string, beforeId: string | null): Promise<Layout>
  createGroup(name: string): Promise<Layout>
  renameGroup(from: string, to: string): Promise<Layout>
  removeGroup(name: string): Promise<Layout>
  reorderGroups(names: string[]): Promise<Layout>
  createTab(init: { cwd?: string; name?: string; group?: string }): Promise<Tab>
  updateTab(id: string, patch: Partial<Pick<Tab, 'name' | 'group' | 'model' | 'permissionMode' | 'baseURL'>>): Promise<Tab>
  openTab(id: string): Promise<void>
  closeTab(id: string, options?: { remove?: boolean }): Promise<void>
  send(id: string, text: string, images?: ImageAttachment[]): Promise<void>
  cancel(id: string): Promise<void>
  permission(id: string, requestId: string, decision: PermissionDecision): Promise<void>
  getConfig(): Promise<ClosetConfig>
  setConfig(patch: Partial<ClosetConfig>): Promise<ClosetConfig>
  pickDirectory(defaultPath?: string): Promise<string | null>
  onEvent(handler: (e: HarnessEvent) => void): () => void
  projectInfo(root: string): Promise<ProjectInfo>
  startDev(root: string, cols: number, rows: number): Promise<ProjectInfo>
  stopDev(root: string): Promise<void>
  startGit(root: string, cols: number, rows: number): Promise<ProjectInfo>
  setDevCommand(root: string, command: string | null): Promise<ProjectInfo>
  ptyAttach(key: string): Promise<PtyAttach>
  ptyInput(key: string, data: string): void
  ptyResize(key: string, cols: number, rows: number): void
  onPty(handler: (e: PtyEvent) => void): () => void
  voiceStatus(): Promise<VoiceStatus>
  voiceRequestMic(): Promise<boolean>
  voiceTranscribe(wav: ArrayBuffer): Promise<string>
  voiceDownloadModel(name?: string): Promise<string>
  onVoice(handler: (e: VoiceEvent) => void): () => void
  listEditors(): Promise<{ id: EditorId; label: string; path: string }[]>
  openInEditor(target: { tabId?: string; root?: string; file?: string; line?: number }): Promise<string | null>
}
