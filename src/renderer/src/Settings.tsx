import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { ClosetConfig, PermissionMode } from '../../shared/types'

export default function Settings(props: { onClose: () => void }) {
  const [config, { mutate }] = createResource(() => window.closet.getConfig())
  const [editors] = createResource(() => window.closet.listEditors())
  const [voice, { refetch: refetchVoice }] = createResource(() => window.closet.voiceStatus())
  const [progress, setProgress] = createSignal<{ received: number; total: number } | null>(null)

  onMount(() => {
    const off = window.closet.onVoice((e) => {
      if (e.type === 'progress') setProgress(e.done ? null : { received: e.received, total: e.total })
      void refetchVoice()
    })
    onCleanup(off)
  })

  const patch = async (p: Partial<ClosetConfig>) => mutate(await window.closet.setConfig(p))
  const patchVoice = async (p: Partial<NonNullable<ClosetConfig['voice']>>) => {
    await patch({ voice: { ...(config()?.voice ?? {}), ...p } })
    await refetchVoice()
  }
  const short = (p: string | null | undefined) => (p ? p.replace(/^\/Users\/[^/]+/, '~') : '')

  return (
    <div class="settings-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="settings" role="dialog" aria-label="Settings">
        <div class="settings-head">
          <strong>Settings</strong>
          <button class="icon" onClick={props.onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <h3>Editor</h3>
        <div class="setting">
          <label>Open files with</label>
          <select value={config()?.editor ?? editors()?.[0]?.id ?? ''} onChange={(e) => patch({ editor: e.currentTarget.value as never })}>
            <For each={editors() ?? []}>{(ed) => <option value={ed.id}>{ed.label}</option>}</For>
          </select>
          <span class="hint">Used by ↗ on tool rows, file paths in replies, and the project pane. Detected on this machine only.</span>
        </div>

        <h3>New tabs</h3>
        <div class="setting">
          <label>Default folder</label>
          <div class="row">
            <input type="text" class="mono" value={short(config()?.defaultCwd)} readOnly />
            <button
              onClick={async () => {
                const dir = await window.closet.pickDirectory(config()?.defaultCwd)
                if (dir) await patch({ defaultCwd: dir })
              }}
            >
              Change…
            </button>
          </div>
          <label>Permission mode</label>
          <select value={config()?.defaultPermissionMode ?? 'auto'} onChange={(e) => patch({ defaultPermissionMode: e.currentTarget.value as PermissionMode })}>
            <option value="auto">auto</option>
            <option value="default">ask</option>
            <option value="acceptEdits">accept edits</option>
            <option value="plan">plan</option>
            <option value="bypassPermissions">bypass</option>
          </select>
        </div>

        <h3>Voice</h3>
        <div class="setting">
          <span class="k">Status</span>
          <span>
            <span class="status-dot" classList={{ ok: !!voice()?.server && !!voice()?.model, warn: !!voice()?.server && !voice()?.model, bad: !voice()?.server }} />
            {!voice()?.server
              ? 'whisper-server not found'
              : voice()?.running
                ? 'ready · server warm'
                : voice()?.model
                  ? 'ready · server starts on first use'
                  : 'model downloads on first use (base.en, 148 MB)'}
            <Show when={progress()}>
              {(p) => <span class="muted"> · downloading {Math.round((p().received / Math.max(1, p().total)) * 100)}%</span>}
            </Show>
          </span>
          <label>whisper-server</label>
          <input
            type="text"
            class="mono"
            placeholder={short(voice()?.server) || 'path to whisper-server'}
            value={config()?.voice?.serverPath ?? ''}
            onChange={(e) => patchVoice({ serverPath: e.currentTarget.value || undefined })}
          />
          <span class="hint">Leave blank to auto-detect. Install with <code>brew install whisper-cpp</code>.</span>
          <label>Model</label>
          <input
            type="text"
            class="mono"
            placeholder={short(voice()?.model) || `auto: ${short(voice()?.modelsDir)}/ggml-base.en.bin`}
            value={config()?.voice?.modelPath ?? ''}
            onChange={(e) => patchVoice({ modelPath: e.currentTarget.value || undefined })}
          />
          <span class="hint">Any whisper.cpp ggml model. Leave blank to use what's found{voice()?.modelSizeMb ? ` (currently ${voice()!.modelSizeMb} MB)` : ''}.</span>
          <label>After dictation</label>
          <select value={config()?.voice?.autoSend ? 'send' : 'review'} onChange={(e) => patchVoice({ autoSend: e.currentTarget.value === 'send' })}>
            <option value="review">put text in the composer</option>
            <option value="send">send immediately</option>
          </select>
        </div>
      </div>
    </div>
  )
}
