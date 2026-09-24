import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { createMemo } from 'solid-js'
import 'highlight.js/styles/github-dark-dimmed.css'

for (const [name, lang] of Object.entries({ bash, css, diff, go, ini, javascript, json, kotlin, markdown, python, rust, sql, swift, typescript, xml, yaml }))
  hljs.registerLanguage(name, lang)
hljs.registerAliases(['sh', 'zsh', 'shell', 'console'], { languageName: 'bash' })
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['toml'], { languageName: 'ini' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['md'], { languageName: 'markdown' })

const PATH_RE = /^(~\/|\/|\.{1,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,8}(?::(\d+))?(?::\d+)?$|^(~\/|\/)(?:[\w.@-]+\/)*[\w.@-]+(?::(\d+))?$/

export function parsePathRef(text: string): { file: string; line?: number } | null {
  const m = PATH_RE.exec(text.trim())
  if (!m) return null
  const line = m[2] ?? m[4]
  const file = text.trim().replace(/(?::\d+)+$/, '')
  if (!file.includes('/') && !file.includes('.')) return null
  return { file, line: line ? Number(line) : undefined }
}

marked.use({
  renderer: {
    codespan({ text }) {
      const ref = parsePathRef(text)
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return ref ? `<code class="path" data-file="${ref.file}" data-line="${ref.line ?? ''}" title="Open in editor">${escaped}</code>` : `<code>${escaped}</code>`
    },
  },
})

marked.use(
  { gfm: true, breaks: false },
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : null
      if (language) return hljs.highlight(code, { language }).value
      return code.length < 4000 ? hljs.highlightAuto(code).value : hljs.highlight(code, { language: 'markdown' }).value
    },
  }),
)

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
}

export default function Markdown(props: { text: string; class?: string; tabId?: string }) {
  const html = createMemo(() => renderMarkdown(props.text))
  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest('code.path') as HTMLElement | null
    if (!el) return
    e.preventDefault()
    const line = el.dataset.line ? Number(el.dataset.line) : undefined
    window.closet.openInEditor({ tabId: props.tabId, file: el.dataset.file, line })
  }
  return <div class={`md ${props.class ?? ''}`} innerHTML={html()} onClick={onClick} />
}
