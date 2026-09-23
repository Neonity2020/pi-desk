import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import * as pty from 'node-pty'
import type { AppData, GitFile, GitOverview, Message, PiEvent, PiModel, Project, Task } from '../src/types'

const execFileAsync = promisify(execFile)
let mainWindow: BrowserWindow | null = null
const piProcesses = new Map<string, ReturnType<typeof spawn>>()
const piBuffers = new Map<string, string>()
const piText = new Map<string, string>()
const piPending = new Map<string, string[]>()
const piRequests = new Map<string, (record: Record<string, unknown>) => void>()
const piReady = new Map<string, Promise<void>>()
const terminalProcesses = new Map<string, pty.IPty>()
const terminalBuffers = new Map<string, string>()

app.setName('Pi Desk')
app.setPath('userData', join(app.getPath('appData'), 'PiDesk'))

function dataFile(): string { return join(app.getPath('userData'), 'workspace.json') }
function readData(): AppData {
  try {
    const data = JSON.parse(readFileSync(dataFile(), 'utf8')) as AppData
    if (Array.isArray(data.projects) && Array.isArray(data.tasks)) return data
  } catch { /* A new app starts with an empty workspace. */ }
  return { projects: [], tasks: [], selectedTaskId: null, selectedProjectId: null }
}
function saveData(data: AppData): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(dataFile(), JSON.stringify(data, null, 2))
}
function findProject(id: string): Project {
  const project = readData().projects.find(item => item.id === id)
  if (!project) throw new Error('Project not found')
  return project
}
function findTask(id: string): Task {
  const task = readData().tasks.find(item => item.id === id)
  if (!task) throw new Error('Task not found')
  return task
}
function projectFile(project: Project, path: string): string {
  const full = resolve(project.path, path)
  const rel = relative(project.path, full)
  const actual = realpathSync(full)
  const actualRel = relative(realpathSync(project.path), actual)
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('/') || actualRel === '..' || actualRel.startsWith('../') || actualRel.startsWith('/')) throw new Error('Path is outside this project')
  return full
}
function updateTask(id: string, change: (task: Task) => void): Task {
  const data = readData()
  const task = data.tasks.find(item => item.id === id)
  if (!task) throw new Error('Task not found')
  change(task)
  task.updatedAt = Date.now()
  saveData(data)
  return task
}
function sendPi(event: PiEvent): void { mainWindow?.webContents.send('pi:event', event) }
function executablePath(): string {
  const candidates = [
    join(homedir(), '.bun/bin/pi'), '/opt/homebrew/bin/pi', '/usr/local/bin/pi',
    ...(process.env.PATH || '').split(':').map(dir => join(dir, 'pi'))
  ]
  return candidates.find(existsSync) || 'pi'
}
function childEnv(): NodeJS.ProcessEnv {
  const nvmRoot = join(homedir(), '.nvm/versions/node')
  let nodeBins: string[] = []
  try {
    nodeBins = readdirSync(nvmRoot)
      .filter(name => /^v\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => Number(b.slice(1).split('.')[0]) - Number(a.slice(1).split('.')[0]))
      .map(name => join(nvmRoot, name, 'bin'))
  } catch { /* NVM is optional. */ }
  return { ...process.env, PATH: [...nodeBins, join(homedir(), '.bun/bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':') }
}
function sendCommand(taskId: string, command: Record<string, unknown>): void {
  const child = piProcesses.get(taskId)
  if (!child?.stdin?.writable) throw new Error('Pi is not running for this task')
  child.stdin.write(JSON.stringify(command) + '\n')
}
function handlePiRecord(taskId: string, record: Record<string, unknown>): void {
  if (record.type === 'response' && typeof record.id === 'string') {
    const resolveRequest = piRequests.get(record.id)
    if (resolveRequest) { piRequests.delete(record.id); resolveRequest(record) }
  } else if (record.type === 'message_update') {
    const update = record.assistantMessageEvent as { type?: string; delta?: string } | undefined
    if (update?.type === 'text_delta' && update.delta) {
      piText.set(taskId, (piText.get(taskId) || '') + update.delta)
      sendPi({ taskId, type: 'delta', text: update.delta })
    }
  } else if (record.type === 'tool_execution_start') {
    const name = String(record.toolName || 'tool')
    sendPi({ taskId, type: 'tool', text: name })
  } else if (record.type === 'agent_settled') {
    const text = piText.get(taskId)?.trim()
    if (text) updateTask(taskId, task => task.messages.push({ id: crypto.randomUUID(), role: 'assistant', text, createdAt: Date.now() }))
    piText.delete(taskId)
    sendPi({ taskId, type: 'settled' })
  } else if (record.type === 'response' && record.command === 'prompt' && record.success === false) {
    sendPi({ taskId, type: 'error', text: String(record.error || 'Pi rejected the prompt') })
  }
}
function launchPi(task: Task): Promise<void> {
  if (piProcesses.has(task.id)) return piReady.get(task.id) || Promise.resolve()
  const project = findProject(task.projectId)
  const sessionDir = join(app.getPath('userData'), 'pi-sessions')
  mkdirSync(sessionDir, { recursive: true })
  const child = spawn(executablePath(), ['--mode', 'rpc', '--session-id', task.id, '--session-dir', sessionDir], {
    cwd: project.path, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe']
  })
  piProcesses.set(task.id, child)
  const ready = new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve())
    child.once('error', reject)
  })
  void ready.catch(() => undefined)
  piReady.set(task.id, ready)
  piBuffers.set(task.id, '')
  child.stdout?.on('data', (chunk: Buffer) => {
    let buffer = (piBuffers.get(task.id) || '') + chunk.toString('utf8')
    let split = buffer.indexOf('\n')
    while (split >= 0) {
      const line = buffer.slice(0, split).replace(/\r$/, '')
      buffer = buffer.slice(split + 1)
      if (line) {
        try { handlePiRecord(task.id, JSON.parse(line)) }
        catch { sendPi({ taskId: task.id, type: 'error', text: 'Pi sent an unreadable response.' }) }
      }
      split = buffer.indexOf('\n')
    }
    piBuffers.set(task.id, buffer)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const message = chunk.toString('utf8').trim()
    if (message) sendPi({ taskId: task.id, type: 'tool', text: message.slice(0, 240) })
  })
  child.on('error', error => sendPi({ taskId: task.id, type: 'error', text: `Could not start Pi: ${error.message}` }))
  child.on('exit', code => {
    piProcesses.delete(task.id)
    piReady.delete(task.id)
    piBuffers.delete(task.id)
    if (code && code !== 0) sendPi({ taskId: task.id, type: 'error', text: `Pi exited with code ${code}. Check that Pi is installed and signed in.` })
  })
  child.on('spawn', () => {
    sendPi({ taskId: task.id, type: 'ready' })
    const pending = piPending.get(task.id) || []
    piPending.delete(task.id)
    for (const message of pending) sendCommand(task.id, { id: crypto.randomUUID(), type: 'prompt', message, streamingBehavior: 'followUp' })
  })
  return ready
}
async function requestPi(taskId: string, command: Record<string, unknown>): Promise<Record<string, unknown>> {
  const task = findTask(taskId)
  await launchPi(task)
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { piRequests.delete(id); reject(new Error('Pi did not respond in time')) }, 15000)
    piRequests.set(id, record => {
      clearTimeout(timer)
      if (record.success === false) reject(new Error(String(record.error || 'Pi command failed')))
      else resolve((record.data || {}) as Record<string, unknown>)
    })
    try { sendCommand(taskId, { id, ...command }) } catch (error) { clearTimeout(timer); piRequests.delete(id); reject(error) }
  })
}
async function git(project: Project, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', project.path, ...args], { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })
  return stdout
}
async function overview(project: Project): Promise<GitOverview> {
  try {
    const [branch, status, numstat] = await Promise.all([
      git(project, ['branch', '--show-current']),
      git(project, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      git(project, ['diff', 'HEAD', '--numstat']).catch(() => git(project, ['diff', '--cached', '--numstat']).catch(() => ''))
    ])
    const counts = new Map<string, [number, number]>()
    for (const line of numstat.split('\n')) {
      const parts = line.split('\t')
      if (parts.length >= 3) counts.set(parts.slice(2).join('\t'), [Number(parts[0]) || 0, Number(parts[1]) || 0])
    }
    const files: GitFile[] = []
    const entries = status.split('\0').filter(Boolean)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const code = entry.slice(0, 2)
      const path = entry.slice(3)
      if (code.includes('R') || code.includes('C')) i++
      const [additions, deletions] = counts.get(path) || [0, 0]
      files.push({ path, status: code, additions, deletions })
    }
    return { branch: branch.trim() || 'HEAD', files, isRepository: true }
  } catch { return { branch: '', files: [], isRepository: false } }
}
async function diff(project: Project, path: string): Promise<string> {
  const state = await overview(project)
  if (!state.files.some(file => file.path === path)) throw new Error('File is not in the change list')
  if (state.files.find(file => file.path === path)?.status === '??') {
    const full = projectFile(project, path)
    const content = readFileSync(full, 'utf8')
    return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${content.split('\n').length} @@\n` + content.split('\n').map(line => '+' + line).join('\n')
  }
  return git(project, ['diff', 'HEAD', '--', path]).catch(async () => {
    const [staged, unstaged] = await Promise.all([
      git(project, ['diff', '--cached', '--', path]).catch(() => ''),
      git(project, ['diff', '--', path]).catch(() => '')
    ])
    return [staged, unstaged].filter(Boolean).join('\n')
  })
}
function setupIPC(): void {
  ipcMain.handle('data:get', () => readData())
  ipcMain.handle('project:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: 'Open a project folder' })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    const data = readData()
    let project = data.projects.find(item => item.path === path)
    if (!project) {
      project = { id: crypto.randomUUID(), name: basename(path), path, createdAt: Date.now() }
      data.projects.unshift(project)
    }
    data.selectedProjectId = project.id
    data.selectedTaskId = data.tasks.find(item => item.projectId === project!.id)?.id || null
    saveData(data)
    return project
  })
  ipcMain.handle('task:new', (_, projectId: string) => {
    findProject(projectId)
    const now = Date.now()
    const task: Task = { id: crypto.randomUUID(), projectId, title: 'New task', createdAt: now, updatedAt: now, messages: [] }
    const data = readData()
    data.tasks.unshift(task)
    data.selectedProjectId = projectId
    data.selectedTaskId = task.id
    saveData(data)
    return task
  })
  ipcMain.handle('task:select', (_, id: string) => {
    const task = findTask(id)
    const data = readData()
    data.selectedTaskId = id
    data.selectedProjectId = task.projectId
    saveData(data)
  })
  ipcMain.handle('task:update', (_, task: Task) => {
    updateTask(task.id, current => { current.title = task.title })
  })
  ipcMain.handle('task:delete', (_, id: string) => {
    const data = readData()
    data.tasks = data.tasks.filter(task => task.id !== id)
    if (data.selectedTaskId === id) data.selectedTaskId = data.tasks.find(task => task.projectId === data.selectedProjectId)?.id || null
    saveData(data)
    piProcesses.get(id)?.kill()
  })
  ipcMain.handle('pi:status', async () => {
    try {
      const { stdout } = await execFileAsync(executablePath(), ['--version'], { env: childEnv(), timeout: 5000 })
      return { available: true, detail: stdout.trim() || 'Pi is ready' }
    } catch (error) { return { available: false, detail: `Pi check failed: ${error instanceof Error ? error.message : String(error)}` } }
  })
  ipcMain.handle('pi:prompt', (_, id: string, text: string) => {
    const task = findTask(id)
    const message = text.trim()
    if (!message) return
    updateTask(id, current => {
      if (current.messages.length === 0) current.title = message.replace(/\s+/g, ' ').slice(0, 52)
      current.messages.push({ id: crypto.randomUUID(), role: 'user', text: message, createdAt: Date.now() } as Message)
    })
    if (!piProcesses.has(id)) {
      piPending.set(id, [...(piPending.get(id) || []), message])
      launchPi(task)
    } else sendCommand(id, { id: crypto.randomUUID(), type: 'prompt', message, streamingBehavior: 'followUp' })
  })
  ipcMain.handle('pi:stop', (_, id: string) => sendCommand(id, { id: crypto.randomUUID(), type: 'abort' }))
  ipcMain.handle('pi:models', async (_, id: string) => {
    const [modelResult, state] = await Promise.all([requestPi(id, { type: 'get_available_models' }), requestPi(id, { type: 'get_state' })])
    const models = (modelResult.models || []) as PiModel[]
    const current = (state.model || null) as PiModel | null
    let thinkingLevels = ['off']
    if (current) {
      const result = await requestPi(id, { type: 'get_available_thinking_levels' })
      thinkingLevels = (result.levels || ['off']) as string[]
    }
    return { models, current, thinkingLevel: String(state.thinkingLevel || 'off'), thinkingLevels }
  })
  ipcMain.handle('pi:model:set', async (_, id: string, provider: string, modelId: string) => {
    const result = await requestPi(id, { type: 'set_model', provider, modelId })
    const model = (result.model || result) as PiModel
    const [state, levels] = await Promise.all([requestPi(id, { type: 'get_state' }), requestPi(id, { type: 'get_available_thinking_levels' })])
    return { model, thinkingLevel: String(state.thinkingLevel || 'off'), thinkingLevels: (levels.levels || ['off']) as string[] }
  })
  ipcMain.handle('pi:thinking:set', async (_, id: string, level: string) => { await requestPi(id, { type: 'set_thinking_level', level }) })
  ipcMain.handle('git:overview', (_, id: string) => overview(findProject(id)))
  ipcMain.handle('git:diff', (_, id: string, path: string) => diff(findProject(id), path))
  ipcMain.handle('files:list', (_, id: string, path: string) => {
    const project = findProject(id)
    const dir = projectFile(project, path)
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => !['.git', 'node_modules', '.DS_Store', 'out', 'dist', '.next'].includes(entry.name))
      .map(entry => ({ path: join(path, entry.name), name: entry.name, isDirectory: entry.isDirectory() }))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  })
  ipcMain.handle('files:read', (_, id: string, path: string) => {
    const project = findProject(id)
    const full = projectFile(project, path)
    if (statSync(full).size > 1024 * 1024) return 'File is too large to preview (limit: 1 MB).'
    const content = readFileSync(full)
    if (content.includes(0)) return 'Binary file preview is not available.'
    return content.toString('utf8')
  })
  ipcMain.handle('terminal:start', (_, id: string) => {
    if (terminalProcesses.has(id)) return terminalBuffers.get(id) || ''
    const project = findProject(id)
    terminalBuffers.set(id, '')
    const env = Object.fromEntries(Object.entries(childEnv()).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const child = pty.spawn('/bin/zsh', ['-l'], { name: 'xterm-256color', cols: 100, rows: 25, cwd: project.path, env })
    terminalProcesses.set(id, child)
    const emit = (data: string): void => {
      terminalBuffers.set(id, ((terminalBuffers.get(id) || '') + data).slice(-200_000))
      mainWindow?.webContents.send('terminal:data', { projectId: id, data })
    }
    child.onData(emit)
    child.onExit(() => terminalProcesses.delete(id))
    return ''
  })
  ipcMain.handle('terminal:write', (_, id: string, text: string) => terminalProcesses.get(id)?.write(text))
  ipcMain.handle('terminal:resize', (_, id: string, cols: number, rows: number) => terminalProcesses.get(id)?.resize(Math.max(2, cols), Math.max(2, rows)))
  ipcMain.handle('project:reveal', (_, id: string) => shell.showItemInFolder(findProject(id).path))
  ipcMain.handle('file:choose', async (_, id: string) => {
    const project = findProject(id)
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'multiSelections'], defaultPath: project.path, title: 'Attach files' })
    if (result.canceled) return null
    return result.filePaths[0] || null
  })
}

app.whenReady().then(() => {
  setupIPC()
  mainWindow = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1000, minHeight: 650,
    title: 'Pi Desk', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 19, y: 19 },
    backgroundColor: '#101115',
    webPreferences: { preload: join(__dirname, '../preload/preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  for (const child of piProcesses.values()) child.stdin?.end()
  for (const child of terminalProcesses.values()) child.kill()
})
