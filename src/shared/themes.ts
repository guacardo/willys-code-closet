export type ThemeId = 'closet' | 'monokai' | 'paper'

export type Theme = {
  label: string
  scheme: 'dark' | 'light'
  bg: string
  panel: string
  panel2: string
  line: string
  text: string
  muted: string
  accent: string
  accentText: string
  danger: string
  warn: string
  ok: string
  thumb: string
  thumbHover: string
  code: string
}

export const themes: Record<ThemeId, Theme> = {
  closet: {
    label: 'Closet',
    scheme: 'dark',
    bg: '#14161a',
    panel: '#1c1f25',
    panel2: '#22262d',
    line: '#2a2e36',
    text: '#e6e6e6',
    muted: '#8b919c',
    accent: '#e8792b',
    accentText: '#111111',
    danger: '#d9534f',
    warn: '#e0a72a',
    ok: '#5cb85c',
    thumb: '#3a3f4a',
    thumbHover: '#4b515e',
    code: '#c9d1d9',
  },
  monokai: {
    label: 'Monokai',
    scheme: 'dark',
    bg: '#221f26',
    panel: '#2d2a2e',
    panel2: '#403e41',
    line: '#4a474c',
    text: '#fcfcfa',
    muted: '#939293',
    accent: '#78dce8',
    accentText: '#221f26',
    danger: '#ff6188',
    warn: '#ffd866',
    ok: '#a9dc76',
    thumb: '#5b595c',
    thumbHover: '#727072',
    code: '#fcfcfa',
  },
  paper: {
    label: 'Paper',
    scheme: 'light',
    bg: '#f4efe6',
    panel: '#ebe4d8',
    panel2: '#e2dacb',
    line: '#d3c9b6',
    text: '#1f1b16',
    muted: '#7a7064',
    accent: '#b8521f',
    accentText: '#ffffff',
    danger: '#b3261e',
    warn: '#9a6b00',
    ok: '#3d7a3a',
    thumb: '#c9bfae',
    thumbHover: '#b5aa97',
    code: '#2a2520',
  },
}

export const defaultTheme: ThemeId = 'closet'
