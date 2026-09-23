import { contextBridge, ipcRenderer } from 'electron'
import type { DeskAPI, PiEvent, Task } from '../src/types'

const api: DeskAPI = {
  getData: () => ipcRenderer.invoke('data:get'),
  addProject: () => ipcRenderer.invoke('project:add'),
  newTask: (projectId: string) => ipcRenderer.invoke('task:new', projectId),
  selectTask: (taskId: string) => ipcRenderer.invoke('task:select', taskId),
  updateTask: (task: Task) => ipcRenderer.invoke('task:update', task),
  deleteTask: (taskId: string) => ipcRenderer.invoke('task:delete', taskId),
  piStatus: () => ipcRenderer.invoke('pi:status'),
  sendPrompt: (taskId: string, text: string) => ipcRenderer.invoke('pi:prompt', taskId, text),
  stopPrompt: (taskId: string) => ipcRenderer.invoke('pi:stop', taskId),
  onPiEvent: (handler: (event: PiEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: PiEvent): void => handler(event)
    ipcRenderer.on('pi:event', listener)
    return () => ipcRenderer.removeListener('pi:event', listener)
  },
  gitOverview: (projectId: string) => ipcRenderer.invoke('git:overview', projectId),
  gitDiff: (projectId: string, path: string) => ipcRenderer.invoke('git:diff', projectId, path),
  listFiles: (projectId: string, path: string) => ipcRenderer.invoke('files:list', projectId, path),
  readFile: (projectId: string, path: string) => ipcRenderer.invoke('files:read', projectId, path),
  terminalStart: (projectId: string) => ipcRenderer.invoke('terminal:start', projectId),
  terminalWrite: (projectId: string, text: string) => ipcRenderer.invoke('terminal:write', projectId, text),
  terminalResize: (projectId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', projectId, cols, rows),
  onTerminalData: (handler: (event: { projectId: string; data: string }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: { projectId: string; data: string }): void => handler(event)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  revealProject: (projectId: string) => ipcRenderer.invoke('project:reveal', projectId)
}

contextBridge.exposeInMainWorld('desk', api)
