import workletUrl from './recorder-worklet.js?url'

export type RecorderHandle = {
  stop(): Promise<ArrayBuffer>
  cancel(): void
  level: () => number
  seconds: () => number
}

const SAMPLE_RATE = 16000

export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  await ctx.audioWorklet.addModule(workletUrl)
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'recorder', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
  const chunks: Float32Array[] = []
  let samples = 0
  let level = 0
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const buf = e.data
    chunks.push(buf)
    samples += buf.length
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    level = level * 0.6 + Math.sqrt(sum / buf.length) * 0.4
  }
  source.connect(node)
  const started = performance.now()

  const teardown = async () => {
    try {
      source.disconnect()
      node.disconnect()
      node.port.onmessage = null
      for (const t of stream.getTracks()) t.stop()
      await ctx.close()
    } catch {
      return
    }
  }

  return {
    level: () => Math.min(1, level * 6),
    seconds: () => (performance.now() - started) / 1000,
    cancel: () => void teardown(),
    stop: async () => {
      await teardown()
      return encodeWav(chunks, samples, ctx.sampleRate)
    },
  }
}

function encodeWav(chunks: Float32Array[], samples: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, samples * 2, true)
  let off = 44
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return buffer
}
