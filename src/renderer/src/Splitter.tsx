import { createSignal, onCleanup } from 'solid-js'

export function persistedWidth(key: string, fallback: number, min: number, max: number) {
  let initial = fallback
  try {
    const v = Number(localStorage.getItem(`closet.width.${key}`))
    if (v >= min && v <= max) initial = v
  } catch {
    initial = fallback
  }
  const [width, setWidthRaw] = createSignal(initial)
  const setWidth = (w: number) => {
    const clamped = Math.round(Math.min(max, Math.max(min, w)))
    setWidthRaw(clamped)
    try {
      localStorage.setItem(`closet.width.${key}`, String(clamped))
    } catch {
      return
    }
  }
  return [width, setWidth] as const
}

export default function Splitter(props: { onDrag: (dx: number) => void; onDouble?: () => void }) {
  let el!: HTMLDivElement
  let last = 0
  let active = false

  const move = (e: PointerEvent) => {
    if (!active) return
    props.onDrag(e.clientX - last)
    last = e.clientX
  }
  const stop = () => {
    if (!active) return
    active = false
    document.body.classList.remove('resizing')
  }
  const start = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    active = true
    last = e.clientX
    document.body.classList.add('resizing')
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      return
    }
  }

  window.addEventListener('blur', stop)
  onCleanup(() => {
    window.removeEventListener('blur', stop)
    stop()
  })

  return (
    <div
      class="splitter"
      ref={el}
      on:pointerdown={start}
      on:pointermove={move}
      on:pointerup={stop}
      on:pointercancel={stop}
      on:lostpointercapture={stop}
      onDblClick={props.onDouble}
    />
  )
}
