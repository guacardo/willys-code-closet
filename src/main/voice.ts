import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { systemPreferences } from 'electron'
import type { ClosetConfig, VoiceEvent, VoiceStatus } from '../shared/types'
import { configDir } from './config'

const MODELS_DIR = join(configDir, 'models')
const MODEL_URL = (name: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`

const SERVER_CANDIDATES = [
  '/opt/homebrew/bin/whisper-server',
  '/usr/local/bin/whisper-server',
  join(homedir(), 'AIOS/Code/anvil/anvil-video/whisper.cpp/build/bin/whisper-server'),
]
const MODEL_CANDIDATE_DIRS = [MODELS_DIR, join(homedir(), 'AIOS/Code/anvil/anvil-video/whisper.cpp'), join(homedir(), '.cache/whisper-cpp')]

function which(bin: string): Promise<string | null> {
  return new Promise((done) => execFile('/bin/zsh', ['-lc', `command -v ${bin}`], (err, out) => done(err ? null : out.trim() || null)))
}

function findModel(): string | null {
  const preferred = ['ggml-base.en.bin', 'ggml-small.en.bin', 'ggml-medium.en.bin', 'ggml-base.bin', 'ggml-small.bin']
  const found: string[] = []
  for (const dir of MODEL_CANDIDATE_DIRS) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (/^ggml-.*\.bin$/.test(f)) found.push(join(dir, f))
  }
  for (const p of preferred) {
    const hit = found.find((f) => f.endsWith(p))
    if (hit) return hit
  }
  return found[0] ?? null
}

export class VoiceManager {
  private proc: ChildProcess | null = null
  private port = 0
  private starting: Promise<void> | null = null
  private serverPath: string | null = null
  private downloading: string | null = null
  private micGranted: boolean | null = null

  constructor(
    private config: () => ClosetConfig,
    private emit: (e: VoiceEvent) => void,
  ) {}

  private async resolveServer(): Promise<string | null> {
    const override = this.config().voice?.serverPath
    if (override && existsSync(override)) return override
    for (const c of SERVER_CANDIDATES) if (existsSync(c)) return c
    return which('whisper-server')
  }

  private resolveModel(): string | null {
    const override = this.config().voice?.modelPath
    if (override && existsSync(override)) return override
    return findModel()
  }

  async status(): Promise<VoiceStatus> {
    this.serverPath = await this.resolveServer()
    const model = this.resolveModel()
    return {
      server: this.serverPath,
      model,
      modelSizeMb: model ? Math.round(statSync(model).size / 1e6) : null,
      running: this.proc !== null && this.port > 0,
      downloading: this.downloading,
      micGranted: this.micGranted,
      modelsDir: MODELS_DIR,
    }
  }

  async requestMic(): Promise<boolean> {
    if (process.platform !== 'darwin') return (this.micGranted = true)
    const current = systemPreferences.getMediaAccessStatus('microphone')
    if (current === 'granted') return (this.micGranted = true)
    this.micGranted = await systemPreferences.askForMediaAccess('microphone')
    return this.micGranted
  }

  private async ensureServer(): Promise<void> {
    if (this.proc && this.port) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      const server = await this.resolveServer()
      if (!server) throw new Error('whisper-server not found. Install whisper.cpp (brew install whisper-cpp) or set its path in Settings.')
      const model = this.resolveModel() ?? (await this.downloadModel('ggml-base.en.bin'))
      const port = 8200 + Math.floor(Math.random() * 300)
      const proc = spawn(server, ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-nt', '-t', '8'], { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      proc.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
      proc.on('exit', () => {
        if (this.proc === proc) {
          this.proc = null
          this.port = 0
          this.emit({ type: 'server', running: false })
        }
      })
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        if (proc.exitCode !== null) throw new Error(`whisper-server exited: ${stderr.trim().slice(-300)}`)
        try {
          const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
          if (r.ok || r.status === 404) break
        } catch {
          await new Promise((r) => setTimeout(r, 250))
        }
      }
      if (Date.now() >= deadline) {
        proc.kill('SIGKILL')
        throw new Error('whisper-server did not come up in time')
      }
      this.proc = proc
      this.port = port
      this.emit({ type: 'server', running: true })
    })().finally(() => (this.starting = null))
    return this.starting
  }

  async transcribe(wav: Uint8Array): Promise<string> {
    await this.ensureServer()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav')
    form.append('response_format', 'text')
    form.append('temperature', '0.0')
    const r = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`whisper-server ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const text = (await r.text()).replace(/\[BLANK_AUDIO\]/g, '').replace(/\s+/g, ' ').trim()
    return text
  }

  async downloadModel(name = 'ggml-base.en.bin'): Promise<string> {
    if (this.downloading) throw new Error(`already downloading ${this.downloading}`)
    mkdirSync(MODELS_DIR, { recursive: true })
    const dest = join(MODELS_DIR, name)
    if (existsSync(dest)) return dest
    this.downloading = name
    try {
      const r = await fetch(MODEL_URL(name))
      if (!r.ok || !r.body) throw new Error(`download failed: ${r.status}`)
      const total = Number(r.headers.get('content-length') ?? 0)
      const tmp = dest + '.part'
      const out = createWriteStream(tmp)
      let received = 0
      const reader = r.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (!out.write(value)) await new Promise<void>((res) => out.once('drain', () => res()))
        this.emit({ type: 'progress', name, received, total })
      }
      await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())))
      const { renameSync } = await import('node:fs')
      renameSync(tmp, dest)
      return dest
    } finally {
      this.downloading = null
      this.emit({ type: 'progress', name, received: 0, total: 0, done: true })
    }
  }

  shutdown() {
    this.proc?.kill('SIGTERM')
    this.proc = null
    this.port = 0
  }
}
