import { createMemo } from 'solid-js'
import type { TabState } from './store'

type Face = { text: string; tone: 'idle' | 'ok' | 'warn' | 'bad' | 'busy'; title: string }

export function infoFace(t: TabState): Face {
  const l = t.loaded
  const failed = l?.mcpServers.filter((s) => s.status === 'failed') ?? []
  const needsAuth = l?.mcpServers.filter((s) => s.status === 'needs-auth') ?? []
  if (t.starting && !l) return { text: 'starting…', tone: 'busy', title: 'Claude Code is starting' }
  if (!l && !t.live) return { text: 'not started', tone: 'idle', title: 'Send a message to start this session' }
  if (t.compactedAt && Date.now() - t.compactedAt < 15_000) return { text: 'compacted', tone: 'warn', title: 'Context was just compacted' }
  const notes = [
    ...failed.map((s) => `MCP ${s.name}: failed`),
    ...needsAuth.map((s) => `MCP ${s.name}: needs auth`),
  ]
  if (t.context) {
    const pct = Math.round(t.context.percentage)
    const tone = failed.length || pct >= 85 ? 'bad' : needsAuth.length || pct >= 70 ? 'warn' : 'ok'
    return {
      text: `${pct}%${notes.length ? ' !' : ''}`,
      tone,
      title: [`Context ${t.context.totalTokens.toLocaleString()} / ${t.context.maxTokens.toLocaleString()} tokens (${t.context.model})`, ...notes].join('\n'),
    }
  }
  return { text: notes.length ? 'ready !' : 'ready', tone: failed.length ? 'bad' : needsAuth.length ? 'warn' : 'ok', title: ['Session ready', ...notes].join('\n') }
}

export default function InfoButton(props: { tab: TabState; open: boolean; onClick: () => void }) {
  const face = createMemo(() => infoFace(props.tab))
  return (
    <button class={`info ${face().tone}`} classList={{ on: props.open }} onClick={props.onClick} title={`${face().text}\n${face().title}\n⌘I toggles the session panel`} aria-label={face().text}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" />
        <circle cx="8" cy="4.6" r="1" fill="currentColor" />
        <rect x="7.2" y="6.8" width="1.6" height="5" rx="0.8" fill="currentColor" />
      </svg>
    </button>
  )
}
