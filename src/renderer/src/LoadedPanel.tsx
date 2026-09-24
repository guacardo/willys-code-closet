import { For, Show } from 'solid-js'
import type { ContextUsage, Loaded } from '../../shared/types'

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

function ContextSection(props: { usage: ContextUsage }) {
  const u = () => props.usage
  const used = () => u().categories.filter((c) => c.kind === 'used')
  const shortPath = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
  return (
    <div class="ctx">
      <div class="ctx-head">
        <strong>Context</strong>
        <span class="muted">
          {fmt(u().totalTokens)} / {fmt(u().maxTokens)} · {Math.round(u().percentage)}%
        </span>
      </div>
      <div class="ctx-bar" title={`${u().totalTokens.toLocaleString()} of ${u().maxTokens.toLocaleString()} tokens`}>
        <div class="ctx-fill" style={{ width: `${Math.min(100, u().percentage)}%` }} />
      </div>
      <ul class="ctx-list">
        <For each={used()}>
          {(c) => (
            <li>
              <span>{c.name}</span>
              <span class="muted">{fmt(c.tokens)}</span>
            </li>
          )}
        </For>
      </ul>
      <Show when={u().memoryFiles.length}>
        <details>
          <summary>Memory files ({u().memoryFiles.length})</summary>
          <ul class="ctx-list">
            <For each={u().memoryFiles}>
              {(f) => (
                <li>
                  <span class="mono">{shortPath(f.path)}</span>
                  <span class="muted">{fmt(f.tokens)}</span>
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
      <Show when={u().mcpTools.length}>
        <details>
          <summary>MCP tools ({u().mcpTools.length})</summary>
          <ul class="ctx-list">
            <For each={u().mcpTools}>
              {(m) => (
                <li>
                  <span class="mono">{m.serverName}:{m.name}</span>
                  <span class="muted">{fmt(m.tokens)}</span>
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
      <Show when={u().skills.length}>
        <details>
          <summary>Skills ({u().skills.length})</summary>
          <ul class="ctx-list">
            <For each={u().skills}>
              {(s) => (
                <li>
                  <span>{s.name}</span>
                  <span class="muted">{fmt(s.tokens)}</span>
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
      <Show when={u().agents.length}>
        <details>
          <summary>Agents ({u().agents.length})</summary>
          <ul class="ctx-list">
            <For each={u().agents}>
              {(a) => (
                <li>
                  <span>{a.name}</span>
                  <span class="muted">{fmt(a.tokens)}</span>
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
    </div>
  )
}

export default function LoadedPanel(props: { loaded?: Loaded; context?: ContextUsage; starting: boolean; width?: number; onClose: () => void }) {
  return (
    <div class="loaded" style={{ width: props.width ? `${props.width}px` : undefined }}>
      <div class="loaded-head">
        <strong>Session</strong>
        <button class="icon" onClick={props.onClose}>
          ×
        </button>
      </div>
      <Show when={props.context}>{(u) => <ContextSection usage={u()} />}</Show>
      <Show when={props.loaded} fallback={<p class="muted">{props.starting ? 'Starting Claude Code…' : 'Session not started. Send a message or reopen the tab.'}</p>}>
        {(l) => (
          <>
            <dl>
              <dt>Claude Code</dt>
              <dd>{l().claudeCodeVersion || (l().partial ? 'starting… (full readout after first message)' : '')}</dd>
              <dt>Model</dt>
              <dd>{l().model}</dd>
              <dt>Auth</dt>
              <dd>
                {l().subscription ? 'Claude subscription' : l().apiKeySource}
                {l().account?.subscriptionType ? ` (${l().account!.subscriptionType})` : ''}
                {l().account?.email ? ` · ${l().account!.email}` : ''}
              </dd>
              <dt>Permission mode</dt>
              <dd>{l().permissionMode}</dd>
              <dt>cwd</dt>
              <dd class="mono">{l().cwd}</dd>
              <dt>Session</dt>
              <dd class="mono">{l().sessionId}</dd>
            </dl>
            <Section title={`CLAUDE.md files (${l().claudeMdFiles.length})`}>
              <For each={l().claudeMdFiles}>
                {(f) => (
                  <li class="mono">
                    {f.path} <span class="muted">{(f.bytes / 1024).toFixed(1)} KB</span>
                  </li>
                )}
              </For>
            </Section>
            <Show when={l().memoryIndex}>
              {(m) => (
                <Section title={`Memory index (${m().entries} entries)`}>
                  <li class="mono">{m().path}</li>
                </Section>
              )}
            </Show>
            <Section title={`MCP servers (${l().mcpServers.length})`}>
              <For each={l().mcpServers}>
                {(s) => (
                  <li>
                    {s.name} <span class="muted">{s.status}</span>
                  </li>
                )}
              </For>
            </Section>
            <Section title={`Skills (${l().skills.length})`}>
              <li class="wrap">{l().skills.join(', ')}</li>
            </Section>
            <Section title={`Agents (${l().agents.length})`}>
              <li class="wrap">{l().agents.join(', ')}</li>
            </Section>
            <Section title={`Plugins (${l().plugins.length})`}>
              <For each={l().plugins}>{(p) => <li>{p.name}{p.version ? ` ${p.version}` : ''}</li>}</For>
            </Section>
            <Section title={`Slash commands (${l().slashCommands.length})`}>
              <li class="wrap">{l().slashCommands.map((c) => '/' + c).join('  ')}</li>
            </Section>
            <Section title={`Tools (${l().tools.length})`}>
              <li class="wrap">{l().tools.join(', ')}</li>
            </Section>
          </>
        )}
      </Show>
    </div>
  )
}

function Section(props: { title: string; children: any }) {
  return (
    <details open>
      <summary>{props.title}</summary>
      <ul>{props.children}</ul>
    </details>
  )
}
