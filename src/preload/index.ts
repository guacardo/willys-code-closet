import { contextBridge, ipcRenderer } from 'electron'
import type { ClosetApi, HarnessEvent, PtyEvent, VoiceEvent } from '../shared/types'

const api: ClosetApi = {
  getLayout: () => ipcRenderer.invoke('layout:get'),
  moveTab: (id, group, beforeId) => ipcRenderer.invoke('tabs:move', id, group, beforeId),
  createGroup: (name) => ipcRenderer.invoke('groups:create', name),
  renameGroup: (from, to) => ipcRenderer.invoke('groups:rename', from, to),
  removeGroup: (name) => ipcRenderer.invoke('groups:remove', name),
  reorderGroups: (names) => ipcRenderer.invoke('groups:reorder', names),
  createTab: (init) => ipcRenderer.invoke('tabs:create', init),
  updateTab: (id, patch) => ipcRenderer.invoke('tabs:update', id, patch),
  openTab: (id) => ipcRenderer.invoke('tabs:open', id),
  closeTab: (id, options) => ipcRenderer.invoke('tabs:close', id, options),
  send: (id, text, images) => ipcRenderer.invoke('tabs:send', id, text, images ?? []),
  cancel: (id) => ipcRenderer.invoke('tabs:cancel', id),
  permission: (id, requestId, decision) => ipcRenderer.invoke('tabs:permission', id, requestId, decision),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  pickDirectory: (defaultPath) => ipcRenderer.invoke('dialog:pickDirectory', defaultPath),
  onEvent: (handler) => {
    const listener = (_: unknown, e: HarnessEvent) => handler(e)
    ipcRenderer.on('closet:event', listener)
    return () => ipcRenderer.removeListener('closet:event', listener)
  },
  projectInfo: (root) => ipcRenderer.invoke('projects:info', root),
  startDev: (root, cols, rows) => ipcRenderer.invoke('projects:startDev', root, cols, rows),
  stopDev: (root) => ipcRenderer.invoke('projects:stopDev', root),
  startGit: (root, cols, rows) => ipcRenderer.invoke('projects:startGit', root, cols, rows),
  setDevCommand: (root, command) => ipcRenderer.invoke('projects:setDevCommand', root, command),
  ptyAttach: (key) => ipcRenderer.invoke('pty:attach', key),
  ptyInput: (key, data) => ipcRenderer.send('pty:input', key, data),
  ptyResize: (key, cols, rows) => ipcRenderer.send('pty:resize', key, cols, rows),
  onPty: (handler) => {
    const listener = (_: unknown, e: PtyEvent) => handler(e)
    ipcRenderer.on('pty:event', listener)
    return () => ipcRenderer.removeListener('pty:event', listener)
  },
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  voiceRequestMic: () => ipcRenderer.invoke('voice:requestMic'),
  voiceTranscribe: (wav) => ipcRenderer.invoke('voice:transcribe', new Uint8Array(wav)),
  voiceDownloadModel: (name) => ipcRenderer.invoke('voice:downloadModel', name),
  onVoice: (handler) => {
    const listener = (_: unknown, e: VoiceEvent) => handler(e)
    ipcRenderer.on('voice:event', listener)
    return () => ipcRenderer.removeListener('voice:event', listener)
  },
  listEditors: () => ipcRenderer.invoke('editor:list'),
  openInEditor: (target) => ipcRenderer.invoke('editor:open', target),
}

contextBridge.exposeInMainWorld('closet', api)
