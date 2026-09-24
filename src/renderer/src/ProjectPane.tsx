import { createEffect, createResource, createSignal, For, Show, on } from 'solid-js'
import type { ProjectInfo } from '../../shared/types'
import TermPane from './TermPane'
import { setPane, setPinnedProject, state, type TabState } from './store'

export default function ProjectPane(props: { tabId: string; tab: TabState; width?: number; onClose: () => void }) {
  const projects = () => props.tab.projects
  const selectedRoot = () => props.tab.pinnedProject ?? projects()[0]?.root
  const mode = () => props.tab.paneMode
  const [info, { refetch, mutate }] = createResource(selectedRoot, (root) => window.closet.projectInfo(root))
  const [cmdDraft, setCmdDraft] = createSignal<string | null>(null)
  let size = { cols: 100, rows: 30 }

  createEffect(on(() => `${selectedRoot()}|${mode()}`, () => setCmdDraft(null)))

  createEffect(
    on(
      () => [selectedRoot(), mode(), info()?.gitRunning] as const,
      ([root, m, gitRunning]) => {
        if (root && m === 'git' && gitRunning === false) void window.closet.startGit(root, size.cols, size.rows).then(mutate)
      },
    ),
  )

  const startDev = async () => {
    const root = selectedRoot()
    if (!root) return
    const draft = cmdDraft()
    if (draft !== null && draft.trim() && draft.trim() !== info()?.devCommand) await window.closet.setDevCommand(root, draft.trim())
    mutate(await window.closet.startDev(root, size.cols, size.rows))
    setCmdDraft(null)
  }

  const key = () => (mode() === 'dev' ? `${selectedRoot()}::dev` : `${selectedRoot()}::git`)

  return (
    <div class="pane" style={{ width: props.width ? `${props.width}px` : undefined }}>
      <div class="pane-head">
        <div class="chips">
          <For each={projects()}>
            {(p) => (
              <button
                class="chip"
                classList={{ active: p.root === selectedRoot(), pinned: props.tab.pinnedProject === p.root }}
                title={`${p.root}${props.tab.pinnedProject === p.root ? '\nPinned · click to follow the agent again' : '\nClick to pin'}`}
                onClick={() => setPinnedProject(props.tabId, props.tab.pinnedProject === p.root ? null : p.root)}
              >
                <span class="dot" classList={{ live: p.root === selectedRoot() ? !!info()?.devRunning : state.devRunning[p.root] }} />
                {p.name}
                <Show when={props.tab.pinnedProject === p.root}>
                  <span class="pin">📌</span>
                </Show>
              </button>
            )}
          </For>
          <Show when={projects().length === 0}>
            <span class="muted">No project yet. The pane follows whatever repo the agent touches.</span>
          </Show>
        </div>
        <div class="pane-tabs">
          <button classList={{ on: mode() === 'dev' }} onClick={() => setPane(props.tabId, { paneMode: 'dev' })}>
            Dev
          </button>
          <button classList={{ on: mode() === 'git' }} onClick={() => setPane(props.tabId, { paneMode: 'git' })}>
            Git
          </button>
          <button class="icon" title="Open project in editor" disabled={!selectedRoot()} onClick={() => window.closet.openInEditor({ tabId: props.tabId, root: selectedRoot() })}>
            ↗
          </button>
          <button class="icon" title="Close pane (⌘J)" onClick={props.onClose}>
            ×
          </button>
        </div>
      </div>

      <Show when={selectedRoot()} fallback={<div class="pane-empty muted">Send a message that touches a repo, or open the tab inside one.</div>}>
        <Show when={mode() === 'dev'}>
          <div class="pane-toolbar">
            <Show
              when={info()?.devRunning}
              fallback={
                <>
                  <input
                    class="mono"
                    value={cmdDraft() ?? info()?.devCommand ?? ''}
                    placeholder="dev command, e.g. npm run dev"
                    onInput={(e) => setCmdDraft(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Enter' && startDev()}
                  />
                  <button class="primary" onClick={startDev} disabled={!(cmdDraft() ?? info()?.devCommand)}>
                    Start
                  </button>
                </>
              }
            >
              <span class="mono muted">{info()?.devCommand}</span>
              <button class="danger" onClick={() => selectedRoot() && window.closet.stopDev(selectedRoot()!).then(() => refetch())}>
                Stop
              </button>
            </Show>
            <span class="muted small" title={info()?.devLog}>
              log: ~/.config/willys-code-closet/logs/{info()?.name}.dev.log
            </span>
          </div>
        </Show>
        <TermPane
          ptyKey={key()}
          onSize={(c, r) => (size = { cols: c, rows: r })}
          onExit={() => refetch()}
        />
        <Show when={mode() === 'git' && info() && !info()!.gitRunning}>
          <div class="pane-toolbar">
            <span class="muted">lazygit exited.</span>
            <button onClick={() => selectedRoot() && window.closet.startGit(selectedRoot()!, size.cols, size.rows).then(mutate)}>Restart</button>
          </div>
        </Show>
      </Show>
    </div>
  )
}

export type { ProjectInfo }
