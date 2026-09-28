import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { ClosetConfig, PermissionDecision, PermissionMode } from '../../shared/types'
import Sidebar from './Sidebar'
import Transcript from './Transcript'
import LoadedPanel from './LoadedPanel'
import InfoButton from './InfoButton'
import ProjectPane from './ProjectPane'
import Splitter, { persistedWidth } from './Splitter'
import MicButton, { useMic } from './MicButton'
import Settings from './Settings'
import type { ImageAttachment } from '../../shared/types'
import { addUser, applyEvent, emptyTabState, setDevRunning, setPane, orderedTabs, removeTab, setActive, setLayout, state, upsertTab } from './store'

export default function App() {
  const [config, setConfig] = createSignal<ClosetConfig | null>(null)
  const [draft, setDraft] = createSignal('')
  const [showLoaded, setShowLoaded] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [dragOver, setDragOver] = createSignal(false)
  const [sidebarW, setSidebarW] = persistedWidth('sidebar', 240, 160, 520)
  const [paneW, setPaneW] = persistedWidth('pane', 560, 320, 1400)
  const [loadedW, setLoadedW] = persistedWidth('loaded', 380, 280, 800)

  const mic = useMic({
    onText: async (text) => {
      const cfg = await window.closet.getConfig()
      setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')} ${text}` : text))
      if (cfg.voice?.autoSend) void send()
      else {
        fitInput()
        input?.focus()
      }
    },
    onError: (message) => {
      if (state.activeId) applyEvent({ tabId: state.activeId, type: 'error', message })
    },
  })

  const MAX_IMAGE_BYTES = 8 * 1024 * 1024
  async function addFiles(files: Iterable<File>) {
    const next: ImageAttachment[] = []
    for (const f of files) {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type) || f.size > MAX_IMAGE_BYTES) continue
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result).split(',')[1] ?? '')
        r.onerror = () => rej(r.error)
        r.readAsDataURL(f)
      })
      next.push({ media_type: f.type as ImageAttachment['media_type'], data, name: f.name })
    }
    if (next.length) setImages((cur) => [...cur, ...next])
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f)
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files)
    input?.focus()
  }
  let scroller!: HTMLDivElement
  let input!: HTMLTextAreaElement
  let pttHeld = false
  const [following, setFollowing] = createSignal(true)
  let inputResized = false

  function scrollToBottom() {
    setFollowing(true)
    scroller?.scrollTo({ top: scroller.scrollHeight })
  }

  let lastTop = 0
  function onScroll() {
    const top = scroller.scrollTop
    const gap = scroller.scrollHeight - top - scroller.clientHeight
    if (gap < 24) setFollowing(true)
    else if (top < lastTop) setFollowing(false)
    lastTop = top
  }

  function fitInput() {
    const el = input
    if (!el) return
    const max = Math.floor(window.innerHeight * 0.5)
    if (!inputResized) el.style.height = 'auto'
    const needed = Math.min(el.scrollHeight + 2, max)
    if (!inputResized || needed > el.clientHeight) el.style.height = `${needed}px`
  }

  function resetInput() {
    inputResized = false
    if (input) input.style.height = 'auto'
  }

  const active = createMemo(() => state.tabs.find((t) => t.id === state.activeId) ?? null)
  const ts = createMemo(() => (state.activeId ? state.byTab[state.activeId] : undefined) ?? emptyTabState())

  onMount(() => {
    window.closet.getConfig().then(setConfig)
    window.closet.getLayout().then((layout) => {
      setLayout(layout)
      const first = orderedTabs()[0]
      if (first) select(first.id)
    })
    const offPty = window.closet.onPty((e) => {
      if (!e.key.endsWith('::dev')) return
      setDevRunning(e.key.slice(0, -'::dev'.length), e.type === 'data')
    })
    onCleanup(offPty)
    const off = window.closet.onEvent((e) => {
      applyEvent(e)
      if (e.tabId === state.activeId && following()) queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }))
    })
    onCleanup(off)
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' && pttHeld) {
        pttHeld = false
        ev.preventDefault()
        void mic.stop()
      }
    }
    window.addEventListener('keyup', onKeyUp)
    onCleanup(() => window.removeEventListener('keyup', onKeyUp))
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey
      if (mod && ev.key === ',') {
        ev.preventDefault()
        setShowSettings(!showSettings())
        return
      }
      if (ev.key === 'Escape' && showSettings()) {
        setShowSettings(false)
        return
      }
      if (mod && ev.shiftKey && ev.key.toLowerCase() === 'm') {
        ev.preventDefault()
        void mic.toggle()
        return
      }
      if (ev.altKey && ev.code === 'Space') {
        ev.preventDefault()
        if (!ev.repeat && !pttHeld) {
          pttHeld = true
          void mic.start()
        }
        return
      }
      const pending = ts().pendingPermission
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
      if (pending && !typing) {
        const map: Record<string, PermissionDecision> = { y: 'allow', a: 'always', n: 'deny' }
        const d = map[ev.key.toLowerCase()]
        if (d) {
          ev.preventDefault()
          decide(pending, d)
          return
        }
      }
      if (ev.key === 'Escape' && ts().busy && !(document.activeElement as HTMLElement | null)?.closest('.term')) {
        ev.preventDefault()
        if (state.activeId) window.closet.cancel(state.activeId)
      } else if (mod && ev.key.toLowerCase() === 't') {
        ev.preventDefault()
        newTab(ev.shiftKey)
      } else if (mod && ev.key.toLowerCase() === 'w') {
        ev.preventDefault()
        if (state.activeId) closeTab(state.activeId)
      } else if (mod && ev.key.toLowerCase() === 'i') {
        ev.preventDefault()
        setShowLoaded(!showLoaded())
      } else if (mod && ev.key.toLowerCase() === 'j') {
        ev.preventDefault()
        if (state.activeId) setPane(state.activeId, { paneOpen: !ts().paneOpen })
      } else if (mod && (ev.key === '[' || ev.key === ']')) {
        ev.preventDefault()
        cycle(ev.key === ']' ? 1 : -1)
      } else if (mod && /^[1-9]$/.test(ev.key)) {
        const t = orderedTabs()[Number(ev.key) - 1]
        if (t) {
          ev.preventDefault()
          select(t.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  function select(id: string) {
    setActive(id)
    window.closet.openTab(id)
    queueMicrotask(() => {
      scrollToBottom()
      input?.focus()
    })
  }

  function cycle(dir: 1 | -1) {
    const tabs = orderedTabs()
    const i = tabs.findIndex((t) => t.id === state.activeId)
    const next = tabs[(i + dir + tabs.length) % tabs.length]
    if (next) select(next.id)
  }

  async function newTab(pick = false) {
    let cwd = config()?.defaultCwd ?? active()?.cwd
    if (pick || !cwd) {
      const dir = await window.closet.pickDirectory(cwd)
      if (!dir) return
      cwd = dir
    }
    const tab = await window.closet.createTab({ cwd, group: active()?.group })
    upsertTab(tab)
    select(tab.id)
  }

  async function changeCwd() {
    const t = active()
    if (!t) return
    const dir = await window.closet.pickDirectory(t.cwd)
    if (!dir || dir === t.cwd) return
    const tab = await window.closet.createTab({ cwd: dir, name: t.name, group: t.group })
    await window.closet.closeTab(t.id, { remove: true })
    removeTab(t.id)
    upsertTab(tab)
    select(tab.id)
  }

  async function closeTab(id: string) {
    await window.closet.closeTab(id, { remove: true })
    removeTab(id)
    if (state.activeId) select(state.activeId)
  }

  async function rename(id: string, name: string) {
    upsertTab(await window.closet.updateTab(id, { name }))
  }

  async function send() {
    const id = state.activeId
    const text = draft().trim()
    const imgs = images()
    if (!id || (!text && !imgs.length) || ts().busy) return
    setDraft('')
    setImages([])
    resetInput()
    addUser(id, text)
    queueMicrotask(scrollToBottom)
    try {
      await window.closet.send(id, text, imgs)
    } catch (err) {
      applyEvent({ tabId: id, type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  function decide(requestId: string, decision: PermissionDecision) {
    if (state.activeId) window.closet.permission(state.activeId, requestId, decision)
    input.focus()
  }

  async function setModel(model: string) {
    const t = active()
    if (t) upsertTab(await window.closet.updateTab(t.id, { model: model || undefined }))
  }

  async function setMode(mode: PermissionMode) {
    const t = active()
    if (t) upsertTab(await window.closet.updateTab(t.id, { permissionMode: mode }))
  }

  return (
    <div class="app">
      <Sidebar width={sidebarW()} onSelect={select} onNew={() => newTab()} onNewIn={() => newTab(true)} onRename={rename} onClose={closeTab} onSettings={() => setShowSettings(true)} />
      <Show when={showSettings()}>
        <Settings onClose={() => setShowSettings(false)} />
      </Show>
      <Splitter onDrag={(dx) => setSidebarW(sidebarW() + dx)} onDouble={() => setSidebarW(240)} />
      <main
        class="main"
        classList={{ dragover: dragOver() }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes('Files')) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDragOver(false)
        }}
        onDrop={onDrop}
      >
        <Show when={active()} fallback={<Empty onNew={() => newTab()} onNewIn={() => newTab(true)} />}>
          {(tab) => (
            <>
              <header class="bar">
                <span class="tabtitle">{tab().name}</span>
                <button class="cwd mono" title="Working directory · click to change (starts a fresh session in the new folder)" onClick={changeCwd}>
                  {tab().cwd.replace(/^\/Users\/[^/]+/, '~')}
                </button>
                <select
                  class="model"
                  value={tab().model ?? (ts().models.some((m) => m.id === 'default') ? 'default' : '')}
                  onChange={(e) => setModel(e.currentTarget.value === 'default' ? '' : e.currentTarget.value)}
                  title={ts().models.find((m) => m.id === (tab().model ?? 'default'))?.description ?? 'Model for this tab'}
                >
                  <Show when={ts().models.length === 0}>
                    <option value="">{ts().loaded?.model ?? 'default'}</option>
                  </Show>
                  <For each={ts().models}>{(m) => <option value={m.id}>{modelLabel(m)}</option>}</For>
                  <Show when={tab().model && !ts().models.some((m) => m.id === tab().model)}>
                    <option value={tab().model}>{tab().model}</option>
                  </Show>
                </select>
                <select class="mode" value={tab().permissionMode} onChange={(e) => setMode(e.currentTarget.value as PermissionMode)} title="Permission mode">
                  <option value="auto">auto</option>
                  <option value="default">ask</option>
                  <option value="acceptEdits">accept edits</option>
                  <option value="plan">plan</option>
                  <option value="bypassPermissions">bypass</option>
                </select>
                <button
                  class="icon pane-toggle"
                  classList={{ on: ts().paneOpen }}
                  title="Dev server / git pane (⌘J)"
                  onClick={() => setPane(tab().id, { paneOpen: !ts().paneOpen })}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
                    <path d="M4.5 6.5l2.5 2-2.5 2M8.5 10.5h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
                <InfoButton tab={ts()} open={showLoaded()} onClick={() => setShowLoaded(!showLoaded())} />
              </header>

              <div class="body">
                <div class="scrollwrap">
                  <div class="scroll" ref={scroller} onScroll={onScroll}>
                    <Show when={ts().items.length === 0}>
                      <p class="empty">
                        {ts().starting ? 'Starting Claude Code…' : ts().live ? 'Session ready.' : 'Send a message to start this session.'}
                        <br />
                        <span class="muted">Enter sends · Shift+Enter newline · Esc cancels · ⌘T new tab here · ⇧⌘T new tab in another folder · ⌘I session info · ⌘J dev/git pane · ⌘⇧M dictate · hold ⌥Space to talk</span>
                      </p>
                    </Show>
                    <Transcript items={ts().items} tabId={tab().id} showCost={!ts().loaded?.subscription} decide={decide} />
                  </div>
                  <Show when={!following()}>
                    <button class="jump" classList={{ busy: ts().busy }} title="Scroll to bottom and follow new output" onClick={scrollToBottom}>
                      ↓ {ts().busy ? 'new output' : 'bottom'}
                    </button>
                  </Show>
                </div>
                <Show when={ts().paneOpen}>
                  <Splitter onDrag={(dx) => setPaneW(paneW() - dx)} onDouble={() => setPaneW(560)} />
                  <ProjectPane tabId={tab().id} tab={ts()} width={paneW()} onClose={() => setPane(tab().id, { paneOpen: false })} />
                </Show>
                <Show when={showLoaded()}>
                  <Splitter onDrag={(dx) => setLoadedW(loadedW() - dx)} onDouble={() => setLoadedW(380)} />
                  <LoadedPanel loaded={ts().loaded} context={ts().context} starting={ts().starting} width={loadedW()} onClose={() => setShowLoaded(false)} />
                </Show>
              </div>

              <footer class="composer" classList={{ 'has-images': images().length > 0 }}>
                <Show when={images().length}>
                  <div class="attachments">
                    <For each={images()}>
                      {(im, i) => (
                        <span class="attachment" title={im.name}>
                          <img src={`data:${im.media_type};base64,${im.data}`} alt={im.name ?? 'image'} />
                          <button class="remove" title="Remove" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i()))}>
                            ×
                          </button>
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
                <textarea
                  ref={input}
                  value={draft()}
                  placeholder={ts().busy ? 'Working… (Esc to cancel)' : images().length ? 'Add a note about the image(s)…' : 'Message Claude Code · paste or drop images'}
                  rows={1}
                  onPaste={onPaste}
                  onInput={(e) => {
                    setDraft(e.currentTarget.value)
                    fitInput()
                  }}
                  onMouseDown={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    if (r.right - e.clientX < 18 && r.bottom - e.clientY < 18) inputResized = true
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                />
                <MicButton mic={mic} />
                <Show
                  when={ts().busy}
                  fallback={
                    <button class="primary" onClick={send} disabled={!draft().trim() && !images().length}>
                      Send
                    </button>
                  }
                >
                  <button class="danger" onClick={() => state.activeId && window.closet.cancel(state.activeId)}>
                    Stop
                  </button>
                </Show>
              </footer>
              <Show when={ts().status}>
                <div class="statusline mono">{ts().status}</div>
              </Show>
            </>
          )}
        </Show>
      </main>
    </div>
  )
}

function modelLabel(m: { id: string; name: string; resolved?: string; description?: string }): string {
  const version = m.resolved
    ? m.resolved
        .replace(/^claude-/, '')
        .replace(/\[1m\]$/, '')
        .replace(/-(\d+)-(\d+)$/, ' $1.$2')
        .replace(/-(\d+)$/, ' $1')
        .replace(/^(\w)/, (c) => c.toUpperCase())
    : m.name
  const ctx = m.resolved?.endsWith('[1m]') ? ' · 1M ctx' : ''
  return m.id === 'default' ? `Default → ${version}${ctx}` : `${version}${ctx}`
}

function Empty(props: { onNew: () => void; onNewIn: () => void }) {
  return (
    <div class="empty-main">
      <p>No tabs yet.</p>
      <button class="primary" onClick={props.onNew}>
        New tab in ~/AIOS (⌘T)
      </button>
      <button onClick={props.onNewIn}>Pick a folder… (⇧⌘T)</button>
    </div>
  )
}
