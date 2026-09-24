import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClosetConfig, Layout } from '../shared/types'

export const configDir = join(homedir(), '.config', 'willys-code-closet')

function readJson<T>(file: string, fallback: T): T {
  try {
    return { ...fallback, ...(JSON.parse(readFileSync(join(configDir, file), 'utf8')) as T) }
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, file), JSON.stringify(value, null, 2) + '\n')
}

const defaults: ClosetConfig = {
  defaultCwd: join(homedir(), 'AIOS'),
  defaultPermissionMode: 'auto',
}

export const loadConfig = () => readJson<ClosetConfig>('config.json', defaults)
export const saveConfig = (cfg: ClosetConfig) => writeJson('config.json', cfg)

export const loadLayout = () => readJson<Layout>('tabs.json', { tabs: [], groups: [] })
export const saveLayout = (layout: Layout) => writeJson('tabs.json', layout)
