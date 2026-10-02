import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { startRecording, type RecorderHandle } from './voice'

export type MicState = 'idle' | 'recording' | 'transcribing' | 'preparing' | 'error'

export function useMic(opts: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = createSignal<MicState>('idle')
  const [level, setLevel] = createSignal(0)
  const [seconds, setSeconds] = createSignal(0)
  let handle: RecorderHandle | null = null
  let timer: number | undefined
  const [progress, setProgress] = createSignal<number | null>(null)
  onMount(() => {
    const off = window.closet.onVoice((e) => {
      if (e.type !== 'progress') return
      if (e.done) {
        setProgress(null)
        if (state() === 'preparing') setState('transcribing')
      } else {
        setProgress(e.total ? e.received / e.total : 0)
        if (state() === 'transcribing') setState('preparing')
      }
    })
    onCleanup(off)
  })

  const SPEECH_LEVEL = 0.1
  const SILENCE_MS = 8_000
  const NO_SPEECH_MS = 20_000
  const MAX_MS = 10 * 60_000
  let lastLoud = 0
  let spoke = false

  const tick = () => {
    if (!handle) return
    const lv = handle.level()
    const now = performance.now()
    setLevel(lv)
    setSeconds(handle.seconds())
    if (lv > SPEECH_LEVEL) {
      lastLoud = now
      spoke = true
    }
    const quiet = now - lastLoud
    if (handle.seconds() * 1000 > MAX_MS || (spoke && quiet > SILENCE_MS)) {
      void stop()
      return
    }
    if (!spoke && quiet > NO_SPEECH_MS) {
      cancel()
      return
    }
    timer = requestAnimationFrame(tick)
  }

  async function start() {
    if (state() !== 'idle' && state() !== 'error') return
    try {
      const ok = await window.closet.voiceRequestMic()
      if (!ok) throw new Error('Microphone access denied. Allow it in System Settings → Privacy & Security → Microphone.')
      handle = await startRecording()
      lastLoud = performance.now()
      spoke = false
      setState('recording')
      tick()
    } catch (err) {
      setState('error')
      opts.onError(err instanceof Error ? err.message : String(err))
    }
  }

  async function stop() {
    if (state() !== 'recording' || !handle) return
    if (timer !== undefined) cancelAnimationFrame(timer)
    const h = handle
    handle = null
    setState('transcribing')
    try {
      if (h.seconds() < 0.4) {
        h.cancel()
        setState('idle')
        return
      }
      const wav = await h.stop()
      const text = await window.closet.voiceTranscribe(wav)
      if (text) opts.onText(text)
      setState('idle')
    } catch (err) {
      setState('error')
      opts.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setLevel(0)
      setSeconds(0)
    }
  }

  function cancel() {
    if (timer !== undefined) cancelAnimationFrame(timer)
    handle?.cancel()
    handle = null
    setState('idle')
    setLevel(0)
  }

  const toggle = () => (state() === 'recording' ? stop() : start())
  onCleanup(cancel)
  return { state, level, seconds, progress, start, stop, cancel, toggle }
}

export default function MicButton(props: { mic: ReturnType<typeof useMic> }) {
  const s = () => props.mic.state()
  return (
    <button
      class="mic"
      classList={{ recording: s() === 'recording', busy: s() === 'transcribing' || s() === 'preparing', error: s() === 'error' }}
      title={
        s() === 'recording'
          ? 'Stop and transcribe (⌘⇧M, or release ⌥Space) · auto-stops after 8s of silence'
          : s() === 'transcribing'
            ? 'Transcribing…'
            : s() === 'preparing'
              ? `Downloading speech model… ${Math.round((props.mic.progress() ?? 0) * 100)}%`
              : 'Dictate: click or ⌘⇧M to toggle · hold ⌥Space to talk'
      }
      onClick={() => props.mic.toggle()}
      disabled={s() === 'transcribing' || s() === 'preparing'}
    >
      <Show
        when={s() === 'recording'}
        fallback={
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" fill="currentColor" />
            <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        }
      >
        <span class="level" style={{ transform: `scaleY(${0.15 + props.mic.level() * 0.85})` }} />
        <span class="secs">{props.mic.seconds().toFixed(0)}s</span>
      </Show>
      <Show when={s() === 'transcribing' || s() === 'preparing'}>
        <span class="spin" />
      </Show>
      <Show when={s() === 'preparing'}>
        <span class="secs">{Math.round((props.mic.progress() ?? 0) * 100)}%</span>
      </Show>
    </button>
  )
}
