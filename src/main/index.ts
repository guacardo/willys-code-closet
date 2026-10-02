import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { loadConfig, saveConfig } from './config'
import { TabManager } from './sessions/manager'
import { ProjectManager } from './projects'
import { VoiceManager } from './voice'
import type { ClosetConfig, HarnessEvent, ImageAttachment, PermissionDecision, Tab } from '../shared/types'

let win: BrowserWindow | null = null
let config = loadConfig()
let tabs: TabManager
let projects: ProjectManager
let voice: VoiceManager

let quitting = false

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function emit(e: HarnessEvent) {
  send('closet:event', e)
}

process.on('uncaughtException', (err) => {
  console.error(err)
  if (!quitting) dialog.showErrorBox('Willy\'s Code Closet', err.stack ?? String(err))
})

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    title: "Willy's Code Closet",
    icon: join(__dirname, '../../resources/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    backgroundColor: '#14161a',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => (win = null))
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  tabs = new TabManager(() => config, emit)

  ipcMain.handle('layout:get', () => tabs.layout())
  ipcMain.handle('tabs:move', (_e, id: string, group: string, beforeId: string | null) => tabs.moveTab(id, group, beforeId))
  ipcMain.handle('groups:create', (_e, name: string) => tabs.createGroup(name))
  ipcMain.handle('groups:rename', (_e, from: string, to: string) => tabs.renameGroup(from, to))
  ipcMain.handle('groups:remove', (_e, name: string) => tabs.removeGroup(name))
  ipcMain.handle('groups:reorder', (_e, names: string[]) => tabs.reorderGroups(names))
  ipcMain.handle('tabs:create', (_e, init: { cwd?: string; name?: string; group?: string }) => tabs.create(init))
  ipcMain.handle('tabs:update', (_e, id: string, patch: Partial<Tab>) => tabs.update(id, patch))
  ipcMain.handle('tabs:open', (_e, id: string) => tabs.open(id))
  ipcMain.handle('tabs:close', (_e, id: string, opts?: { remove?: boolean }) => tabs.close(id, opts?.remove ?? false))
  ipcMain.handle('tabs:send', (_e, id: string, text: string, images: ImageAttachment[]) => tabs.send(id, text, images))
  ipcMain.handle('tabs:cancel', (_e, id: string) => tabs.cancel(id))
  ipcMain.handle('tabs:permission', (_e, id: string, requestId: string, decision: PermissionDecision) =>
    tabs.permission(id, requestId, decision),
  )
  projects = new ProjectManager(
    () => config,
    (patch) => {
      config = { ...config, ...patch }
      saveConfig(config)
    },
    (e) => send('pty:event', e),
  )
  tabs.setProjectResolver((tabId) => tabs.projectRoots(tabId))
  ipcMain.handle('projects:info', (_e, root: string) => projects.info(root))
  ipcMain.handle('projects:startDev', (_e, root: string, cols: number, rows: number) => projects.startDev(root, cols, rows))
  ipcMain.handle('projects:stopDev', (_e, root: string) => projects.stopDev(root))
  ipcMain.handle('projects:startGit', (_e, root: string, cols: number, rows: number) => projects.startGit(root, cols, rows))
  ipcMain.handle('projects:stopGit', (_e, root: string) => projects.stopGit(root))
  ipcMain.handle('projects:setDevCommand', (_e, root: string, command: string | null) => {
    projects.setDevCommand(root, command)
    return projects.info(root)
  })
  ipcMain.handle('pty:attach', (_e, key: string) => projects.ptys.attach(key))
  ipcMain.on('pty:input', (_e, key: string, data: string) => projects.ptys.write(key, data))
  ipcMain.on('pty:resize', (_e, key: string, cols: number, rows: number) => projects.ptys.resize(key, cols, rows))
  voice = new VoiceManager(() => config, (e) => send('voice:event', e))
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('voice:status', () => voice.status())
  ipcMain.handle('voice:requestMic', () => voice.requestMic())
  ipcMain.handle('voice:transcribe', (_e, wav: Uint8Array) => voice.transcribe(wav))
  ipcMain.handle('voice:downloadModel', (_e, name?: string) => voice.downloadModel(name))
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'))
  ipcMain.handle('editor:list', () => projects.listEditors())
  ipcMain.handle('editor:open', (_e, target: { tabId?: string; root?: string; file?: string; line?: number }) => {
    const tab = target.tabId ? tabs.get(target.tabId) : null
    const roots = target.tabId ? tabs.projectRoots(target.tabId) : []
    return projects.openInEditor({ root: target.root ?? roots[0], file: target.file, line: target.line, cwd: tab?.cwd })
  })
  ipcMain.handle('config:get', () => config)
  ipcMain.handle('config:set', (_e, patch: Partial<ClosetConfig>) => {
    config = { ...config, ...patch }
    saveConfig(config)
    return config
  })
  ipcMain.handle('dialog:pickDirectory', async (_e, defaultPath?: string) => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath })
    return r.canceled ? null : r.filePaths[0]
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
  tabs?.closeAll()
  projects?.shutdown()
  voice?.shutdown()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
