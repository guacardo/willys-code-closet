import { createSignal, For, Match, Show, Switch } from 'solid-js'
import type { PermissionDecision } from '../../shared/types'
import type { Item } from './store'
import Markdown from './Markdown'

export default function Transcript(props: { items: Item[]; tabId: string; showCost: boolean; decide: (id: string, d: PermissionDecision) => void }) {
  return <For each={props.items}>{(item) => <Row item={item} tabId={props.tabId} showCost={props.showCost} decide={props.decide} />}</For>
}

function Row(props: { item: Item; tabId: string; showCost: boolean; decide: (id: string, d: PermissionDecision) => void }) {
  const [open, setOpen] = createSignal(false)
  const it = props.item
  return (
    <Switch>
      <Match when={it.kind === 'user'}>
        {(() => {
          const u = it as Extract<Item, { kind: 'user' }>
          return (
            <div class="row user">
              <Show when={u.images?.length}>
                <div class="thumbs">
                  <For each={u.images}>
                    {(im) => <img src={`data:${im.media_type};base64,${im.data}`} alt={im.name ?? 'image'} onClick={(e) => e.currentTarget.classList.toggle('big')} />}
                  </For>
                </div>
              </Show>
              {u.text}
            </div>
          )
        })()}
      </Match>
      <Match when={it.kind === 'assistant'}>
        <div class="row assistant" classList={{ streaming: (it as Extract<Item, { kind: 'assistant' }>).streaming }}>
          <Markdown text={(it as Extract<Item, { kind: 'assistant' }>).text} tabId={props.tabId} />
        </div>
      </Match>
      <Match when={it.kind === 'tool'}>
        {(() => {
          const t = it as Extract<Item, { kind: 'tool' }>
          return (
            <div class="row tool" classList={{ error: t.is_error, pending: t.result === undefined }}>
              <button class="toolhead" onClick={() => setOpen(!open())}>
                <span class="chev">{open() ? '▾' : '▸'}</span>
                <span class="toolname">{t.name}</span>
                <span class="toolsum">{summarize(t.input)}</span>
                <span class="toolstate">{t.result === undefined ? '…' : t.is_error ? 'error' : 'ok'}</span>
                <Show when={filePathOf(t.input)}>
                  {(fp) => (
                    <span
                      class="openlink"
                      role="button"
                      title={`Open ${fp()} in editor`}
                      onClick={(e) => {
                        e.stopPropagation()
                        window.closet.openInEditor({ tabId: props.tabId, file: fp(), line: lineOf(t.input) })
                      }}
                    >
                      ↗
                    </span>
                  )}
                </Show>
              </button>
              <Show when={open()}>
                <pre class="toolbody">{JSON.stringify(t.input, null, 2)}</pre>
                <Show when={t.result !== undefined}>
                  <pre class="toolbody result">{t.result}</pre>
                </Show>
              </Show>
            </div>
          )
        })()}
      </Match>
      <Match when={it.kind === 'permission'}>
        {(() => {
          const p = it as Extract<Item, { kind: 'permission' }>
          return (
            <div class="row permission" classList={{ resolved: !!p.decision }}>
              <div class="permhead">
                <span class="toolname">{p.tool}</span> <code>{p.summary}</code>
              </div>
              <Show when={!p.decision} fallback={<span class="decision">{p.decision}</span>}>
                <details>
                  <summary>input</summary>
                  <pre class="toolbody">{JSON.stringify(p.input, null, 2)}</pre>
                </details>
                <div class="actions">
                  <button class="primary" onClick={() => props.decide(p.id, 'allow')}>
                    Allow <kbd>y</kbd>
                  </button>
                  <button
                    onClick={() => props.decide(p.id, 'always')}
                    title={
                      p.rules.length
                        ? (p.persistent ? 'Saves a permission rule to your Claude Code settings: ' : 'Allows for this session: ') + p.rules.join(', ')
                        : `Allows every ${p.tool} call for the rest of this session`
                    }
                  >
                    {p.rules.length ? `Don't ask again for ${p.rules.join(', ')}` : `Always ${p.tool} this session`} <kbd>a</kbd>
                  </button>
                  <button class="danger" onClick={() => props.decide(p.id, 'deny')}>
                    Deny <kbd>n</kbd>
                  </button>
                </div>
              </Show>
            </div>
          )
        })()}
      </Match>
      <Match when={it.kind === 'done'}>
        {(() => {
          const d = it as Extract<Item, { kind: 'done' }>
          return (
            <div class="row done" classList={{ error: d.is_error && !d.stopped }}>
              {d.stopped ? 'stopped' : d.is_error ? 'error' : 'done'} · {d.usage.turns} turn{d.usage.turns === 1 ? '' : 's'} · in{' '}
              {d.usage.input.toLocaleString()} · out {d.usage.output.toLocaleString()} · cache {d.usage.cacheRead.toLocaleString()}
              {props.showCost ? ` · $${d.usage.costUsd.toFixed(4)}` : ''} · {(d.usage.durationMs / 1000).toFixed(1)}s
            </div>
          )
        })()}
      </Match>
      <Match when={it.kind === 'compact'}>
        {(() => {
          const c = it as Extract<Item, { kind: 'compact' }>
          return (
            <div class="row done divider">
              {c.trigger === 'resumed' ? 'resumed session · earlier turns above' : `compacted (${c.trigger}) from ${c.preTokens.toLocaleString()} tokens`}
            </div>
          )
        })()}
      </Match>
      <Match when={it.kind === 'error'}>
        <div class="row error">{(it as Extract<Item, { kind: 'error' }>).text}</div>
      </Match>
    </Switch>
  )
}

function filePathOf(input: Record<string, unknown>): string | undefined {
  const v = input.file_path ?? input.notebook_path ?? input.path
  return typeof v === 'string' && v && !v.includes('*') ? v : undefined
}

function lineOf(input: Record<string, unknown>): number | undefined {
  const v = input.offset ?? input.line
  return typeof v === 'number' ? v : undefined
}

function summarize(input: Record<string, unknown>): string {
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}
