import { createSignal } from 'solid-js'
import { defaultTheme, themes, type ThemeId } from '../../shared/themes'

const [themeId, setThemeId] = createSignal<ThemeId>(defaultTheme)
export { themeId }

const vars: Record<string, keyof (typeof themes)['closet']> = {
  '--bg': 'bg',
  '--panel': 'panel',
  '--panel2': 'panel2',
  '--line': 'line',
  '--text': 'text',
  '--muted': 'muted',
  '--accent': 'accent',
  '--accent-text': 'accentText',
  '--danger': 'danger',
  '--warn': 'warn',
  '--ok': 'ok',
  '--thumb': 'thumb',
  '--thumb-hover': 'thumbHover',
  '--code': 'code',
}

export function applyTheme(id: ThemeId | undefined) {
  const t = themes[id ?? defaultTheme] ? (id ?? defaultTheme) : defaultTheme
  const theme = themes[t]
  const root = document.documentElement
  for (const [v, k] of Object.entries(vars)) root.style.setProperty(v, theme[k])
  root.style.colorScheme = theme.scheme
  root.dataset.theme = t
  setThemeId(t)
}

export function termTheme() {
  const t = themes[themeId()]
  return { background: t.bg, foreground: t.text, cursor: t.accent, selectionBackground: t.thumb }
}
