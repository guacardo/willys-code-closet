import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { createEffect, on, onCleanup, onMount } from 'solid-js'
import '@xterm/xterm/css/xterm.css'

export type TermApi = { redraw: () => void }

export default function TermPane(props: {
  ptyKey: string
  replay?: boolean
  onExit?: (code: number) => void
  onSize?: (cols: number, rows: number) => void
  onApi?: (api: TermApi) => void
}) {
  let host!: HTMLDivElement
  let term: Terminal
  let fit: FitAddon
  let key = props.ptyKey

  const doFit = () => {
    try {
      fit.fit()
      props.onSize?.(term.cols, term.rows)
      window.closet.ptyResize(key, term.cols, term.rows)
    } catch {
      return
    }
  }

  const nudge = () => {
    const k = key
    window.closet.ptyResize(k, Math.max(20, term.cols - 1), term.rows)
    setTimeout(() => k === key && window.closet.ptyResize(k, term.cols, term.rows), 60)
  }

  const attach = async () => {
    term.reset()
    const a = await window.closet.ptyAttach(key)
    if (a.buffer && props.replay !== false) term.write(a.buffer)
    doFit()
    if (a.running && props.replay === false) nudge()
  }

  const redraw = () => {
    term.reset()
    doFit()
    nudge()
  }

  onMount(() => {
    term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: { background: '#14161a', foreground: '#e6e6e6', cursor: '#e8792b', selectionBackground: '#3a3f4a' },
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    term.onData((d) => window.closet.ptyInput(key, d))
    const off = window.closet.onPty((e) => {
      if (e.key !== key) return
      if (e.type === 'data') term.write(e.data)
      else props.onExit?.(e.code)
    })
    const ro = new ResizeObserver(() => doFit())
    ro.observe(host)
    props.onApi?.({ redraw })
    void attach()
    onCleanup(() => {
      off()
      ro.disconnect()
      term.dispose()
    })
  })

  createEffect(
    on(
      () => props.ptyKey,
      (k, prev) => {
        if (prev === undefined || k === prev) return
        key = k
        void attach()
      },
    ),
  )

  return <div class="term" ref={host} />
}
