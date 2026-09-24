import { createMemo, createSignal, For, Show } from 'solid-js'
import type { Layout, Tab } from '../../shared/types'
import { layout, setLayout, state } from './store'

type Props = {
  onSelect: (id: string) => void
  onNew: () => void
  onNewIn: () => void
  onRename: (id: string, name: string) => void
  onClose: (id: string) => void
  onSettings: () => void
}

type Pos = 'before' | 'after'
type Drag = { kind: 'tab'; id: string } | { kind: 'group'; name: string }
type Over = { kind: 'tab'; id: string; pos: Pos } | { kind: 'group'; name: string; pos?: Pos }

export default function Sidebar(props: Props & { width?: number }) {
  const [editingTab, setEditingTab] = createSignal<string | null>(null)
  const [editingGroup, setEditingGroup] = createSignal<string | null>(null)
  const [drag, setDrag] = createSignal<Drag | null>(null)
  const [over, setOver] = createSignal<Over | null>(null)
  const lay = createMemo(layout)

  const apply = (p: Promise<Layout>) => p.then(setLayout)
  const endDrag = () => {
    setDrag(null)
    setOver(null)
  }
  const half = (e: DragEvent): Pos => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after'
  }
  const isOverTab = (id: string, pos: Pos) => {
    const o = over()
    return o?.kind === 'tab' && o.id === id && o.pos === pos
  }
  const isOverGroup = (name: string, pos?: Pos) => {
    const o = over()
    return o?.kind === 'group' && o.name === name && o.pos === pos
  }

  async function newGroup() {
    const taken = new Set(lay().groups.map((g) => g.name))
    let name = 'New group'
    for (let n = 2; taken.has(name); n++) name = `New group ${n}`
    await apply(window.closet.createGroup(name))
    setEditingGroup(name)
  }

  function dropOnGroup(name: string) {
    const d = drag()
    const o = over()
    if (d?.kind === 'tab') apply(window.closet.moveTab(d.id, name, null))
    else if (d?.kind === 'group' && d.name !== name && o?.kind === 'group' && o.pos) {
      const names = lay().groups.map((g) => g.name).filter((g) => g !== d.name)
      const i = names.indexOf(name) + (o.pos === 'after' ? 1 : 0)
      names.splice(i, 0, d.name)
      apply(window.closet.reorderGroups(names))
    }
    endDrag()
  }

  const groupZone = (name: string) => ({
    onDragOver: (e: DragEvent) => {
      if (drag()?.kind !== 'tab') return
      e.preventDefault()
      setOver({ kind: 'group', name })
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      dropOnGroup(name)
    },
  })

  const renderTab = (tab: Tab, siblings: Tab[]) => {
    const ts = () => state.byTab[tab.id]
    return (
      <Show
        when={editingTab() !== tab.id}
        fallback={
          <div class="tab editing">
            <InlineName
              value={tab.name}
              onDone={(name) => {
                setEditingTab(null)
                if (name && name !== tab.name) props.onRename(tab.id, name)
              }}
              onCancel={() => setEditingTab(null)}
            />
          </div>
        }
      >
        <div
          class="tab"
          classList={{
            active: state.activeId === tab.id,
            dragging: drag()?.kind === 'tab' && (drag() as { id: string }).id === tab.id,
            before: isOverTab(tab.id, 'before'),
            after: isOverTab(tab.id, 'after'),
          }}
          draggable={true}
          onDragStart={(e) => {
            if (e.dataTransfer) {
              e.dataTransfer.setData('text/plain', tab.id)
              e.dataTransfer.effectAllowed = 'move'
            }
            setTimeout(() => setDrag({ kind: 'tab', id: tab.id }), 0)
          }}
          onDragEnd={endDrag}
          onDragOver={(e) => {
            if (drag()?.kind !== 'tab') return
            e.preventDefault()
            e.stopPropagation()
            setOver({ kind: 'tab', id: tab.id, pos: half(e) })
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const d = drag()
            const o = over()
            if (d?.kind === 'tab' && d.id !== tab.id && o?.kind === 'tab') {
              const i = siblings.findIndex((t) => t.id === tab.id)
              const before = o.pos === 'before' ? tab.id : (siblings[i + 1]?.id ?? null)
              if (before !== d.id) apply(window.closet.moveTab(d.id, tab.group, before))
            }
            endDrag()
          }}
          onClick={() => props.onSelect(tab.id)}
          onDblClick={() => setEditingTab(tab.id)}
          title={tab.cwd}
        >
          <span class="dot" classList={{ busy: ts()?.busy, live: ts()?.live && !ts()?.busy }} />
          <span class="tab-name">{tab.name}</span>
          <Show when={ts()?.unread}>
            <span class="badge">{ts()?.unread}</span>
          </Show>
          <button
            class="close"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              props.onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      </Show>
    )
  }

  return (
    <aside class="sidebar" style={{ width: props.width ? `${props.width}px` : undefined }}>
      <div class="sidebar-head">
        <span class="brand">Code Closet</span>
        <span class="head-actions">
          <button class="icon" title="New tab in the current folder (⌘T)" onClick={props.onNew}>
            +
          </button>
          <button class="icon" title="New tab in another folder… (⇧⌘T)" onClick={props.onNewIn}>
            ⋯
          </button>
          <button class="icon" title="New group" onClick={newGroup}>
            ⊞
          </button>
        </span>
      </div>
      <div class="tablist">
        <div class="group" classList={{ over: isOverGroup('') }} {...groupZone('')}>
          <For each={lay().ungrouped}>{(tab) => renderTab(tab, lay().ungrouped)}</For>
          <Show when={drag()?.kind === 'tab' && lay().ungrouped.length === 0}>
            <div class="dropzone">no group</div>
          </Show>
        </div>
        <For each={lay().groups}>
          {(g) => (
            <div class="group" classList={{ over: isOverGroup(g.name) }} {...groupZone(g.name)}>
              <Show
                when={editingGroup() !== g.name}
                fallback={
                  <div class="group-name editing">
                    <InlineName
                      value={g.name}
                      onDone={(name) => {
                        setEditingGroup(null)
                        if (name && name !== g.name) apply(window.closet.renameGroup(g.name, name))
                      }}
                      onCancel={() => setEditingGroup(null)}
                    />
                  </div>
                }
              >
                <div
                  class="group-name"
                  classList={{
                    dragging: drag()?.kind === 'group' && (drag() as { name: string }).name === g.name,
                    before: isOverGroup(g.name, 'before'),
                    after: isOverGroup(g.name, 'after'),
                  }}
                  tabindex={0}
                  draggable={true}
                  onDragStart={(e) => {
                    if (e.dataTransfer) {
                      e.dataTransfer.setData('text/plain', g.name)
                      e.dataTransfer.effectAllowed = 'move'
                    }
                    setTimeout(() => setDrag({ kind: 'group', name: g.name }), 0)
                  }}
                  onDragEnd={endDrag}
                  onDragOver={(e) => {
                    const d = drag()
                    if (!d) return
                    e.preventDefault()
                    e.stopPropagation()
                    setOver(d.kind === 'group' ? { kind: 'group', name: g.name, pos: half(e) } : { kind: 'group', name: g.name })
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    dropOnGroup(g.name)
                  }}
                  onDblClick={() => setEditingGroup(g.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setEditingGroup(g.name)
                    }
                  }}
                  title="Enter or double-click to rename · drag to reorder"
                >
                  <span class="tab-name">{g.name}</span>
                  <button
                    class="close"
                    title="Remove group (tabs stay, ungrouped)"
                    onClick={(e) => {
                      e.stopPropagation()
                      apply(window.closet.removeGroup(g.name))
                    }}
                  >
                    ×
                  </button>
                </div>
              </Show>
              <For each={g.tabs}>{(tab) => renderTab(tab, g.tabs)}</For>
            </div>
          )}
        </For>
      </div>
      <div class="sidebar-foot">
        <button class="icon gear" title="Settings (⌘,)" onClick={props.onSettings}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
        <span>double-click to rename · drag to reorder or group</span>
      </div>
    </aside>
  )
}

function InlineName(props: { value: string; onDone: (value: string) => void; onCancel: () => void }) {
  let el!: HTMLInputElement
  let done = false
  const finish = (value: string | null) => {
    if (done) return
    done = true
    if (value === null) props.onCancel()
    else props.onDone(value.trim())
  }
  return (
    <input
      class="inline-name"
      ref={(n) => {
        el = n
        queueMicrotask(() => {
          n.focus()
          n.select()
        })
      }}
      value={props.value}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(el.value)
        } else if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(el.value)}
    />
  )
}
