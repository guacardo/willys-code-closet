import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename } from 'node:path'
import type { ClosetConfig, HarnessEvent, ImageAttachment, PermissionDecision } from '../shared/types'
import type { TabManager } from './sessions/manager'

const BODY_MAX = 50 * 1024 * 1024
export const DEFAULT_PORT = 7474

export class ApiServer {
  private server: Server
  private streams = new Map<string, Set<ServerResponse>>()

  constructor(
    private tabs: TabManager,
    private config: () => ClosetConfig,
  ) {
    this.server = createServer((req, res) => void this.handle(req, res).catch((err) => this.fail(res, 500, String(err))))
  }

  start() {
    const port = this.config().api?.port ?? DEFAULT_PORT
    this.server.listen(port, '127.0.0.1')
    this.server.on('error', (err) => console.error('[api]', err.message))
  }

  stop() {
    for (const set of this.streams.values()) for (const res of set) res.end()
    this.streams.clear()
    this.server.close()
  }

  broadcast(e: HarnessEvent) {
    const set = this.streams.get(e.tabId)
    if (!set) return
    const line = `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`
    for (const res of set) res.write(line)
  }

  private authorized(req: IncomingMessage) {
    const login = this.config().api?.login
    if (!login) return true
    return req.headers['tailscale-user-login'] === login
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (!this.authorized(req)) return this.fail(res, 403, 'forbidden')
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    const method = req.method ?? 'GET'

    if (method === 'GET' && parts.length === 0) return this.json(res, { ok: true, name: "Willy's Code Closet" })

    if (parts[0] === 'tabs') {
      if (method === 'GET' && parts.length === 1) return this.json(res, { tabs: this.listTabs() })
      const tab = this.findTab(decodeURIComponent(parts[1] ?? ''))
      if (!tab) return this.fail(res, 404, 'no such tab')
      const action = parts[2]
      if (method === 'GET' && !action) return this.json(res, { tab, ...this.tabs.snapshot(tab.id) })
      if (method === 'GET' && action === 'events') return this.stream(res, tab.id)
      if (method === 'POST' && action === 'send') return this.sendTo(tab, await this.body(req), res)
      if (method === 'POST' && action === 'permission') {
        const body = await this.body<{ requestId?: string; decision?: PermissionDecision }>(req)
        if (!body.requestId || !body.decision) return this.fail(res, 400, 'requestId and decision required')
        this.tabs.permission(tab.id, body.requestId, body.decision)
        return this.json(res, { ok: true })
      }
      if (method === 'POST' && action === 'cancel') {
        await this.tabs.cancel(tab.id)
        return this.json(res, { ok: true })
      }
    }

    if (method === 'POST' && parts[0] === 'send' && parts.length === 1) {
      const body = await this.body<{ tab?: string; text?: string; images?: ImageAttachment[] }>(req)
      const tab = this.findTab(body.tab ?? '')
      if (!tab) return this.fail(res, 404, `no tab matching "${body.tab ?? ''}"`)
      return this.sendTo(tab, body, res)
    }

    return this.fail(res, 404, 'not found')
  }

  private sendTo(tab: { id: string; name: string }, body: { text?: string; images?: ImageAttachment[] }, res: ServerResponse) {
    const text = (body.text ?? '').trim()
    const images = (body.images ?? []).filter((im) => im && typeof im.data === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(im.media_type))
    if (!text && !images.length) return this.fail(res, 400, 'text or images required')
    if (this.tabs.snapshot(tab.id).busy) return this.fail(res, 409, 'tab is busy')
    this.tabs.send(tab.id, text, images)
    return this.json(res, { ok: true, tab: tab.id, name: tab.name }, 202)
  }

  private listTabs() {
    return this.tabs.layout().tabs.map((t) => {
      const s = this.tabs.snapshot(t.id)
      return {
        id: t.id,
        name: t.name,
        group: t.group,
        cwd: t.cwd,
        busy: s.busy,
        pending: s.pending.map((p) => ({ requestId: p.requestId, tool: p.tool, summary: p.summary })),
      }
    })
  }

  private findTab(ref: string) {
    const all = this.tabs.layout().tabs
    const q = ref.trim().toLowerCase()
    if (!q) return undefined
    return (
      all.find((t) => t.id === ref) ??
      all.find((t) => t.name.toLowerCase() === q) ??
      all.find((t) => basename(t.cwd).toLowerCase() === q) ??
      all.find((t) => t.name.toLowerCase().includes(q) || basename(t.cwd).toLowerCase().includes(q))
    )
  }

  private stream(res: ServerResponse, tabId: string) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(`event: snapshot\ndata: ${JSON.stringify(this.tabs.snapshot(tabId))}\n\n`)
    let set = this.streams.get(tabId)
    if (!set) this.streams.set(tabId, (set = new Set()))
    set.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
    res.on('close', () => {
      clearInterval(ping)
      set.delete(res)
    })
  }

  private body<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > BODY_MAX) {
          reject(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        try {
          resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as T) : ({} as T))
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }

  private json(res: ServerResponse, value: unknown, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(value))
  }

  private fail(res: ServerResponse, status: number, error: string) {
    if (res.headersSent) return res.end()
    this.json(res, { error }, status)
  }
}
