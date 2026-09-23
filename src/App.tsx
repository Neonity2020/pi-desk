import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight,
  CircleHelp, Code2, Command, FileCode2, FileDiff, Folder, FolderOpen,
  GitBranch, GitPullRequest, PanelRight, MessageCircle, MoreHorizontal,
  Mic, PanelBottom, Paperclip, Plus, RefreshCw, Search, Send, Settings2, Shield,
  Sparkles, Square,
  Terminal as TerminalIcon, Trash2, X
} from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { AppData, FileEntry, GitFile, GitOverview, PiEvent, PiModel, PiStatus, Project, Task } from './types'

const emptyData: AppData = { projects: [], tasks: [], selectedProjectId: null, selectedTaskId: null }
const emptyGit: GitOverview = { branch: '', files: [], isRepository: false }
type PiModelState = { models: PiModel[]; current: PiModel | null; thinkingLevel: string; thinkingLevels: string[] }
const modelCache = new Map<string, PiModelState>()

function shortTime(value: number): string {
  const date = new Date(value)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay ? date.toLocaleTimeString('zh-CN', { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const levelNames: Record<string, string> = { off: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高' }
function levelLabel(level: string): string { return levelNames[level] || level }

function App() {
  const [data, setData] = useState<AppData>(emptyData)
  const [pi, setPi] = useState<PiStatus>({ available: false, detail: '正在检查 Pi…' })
  const [git, setGit] = useState<GitOverview>(emptyGit)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [draft, setDraft] = useState('')
  const [modelMenu, setModelMenu] = useState(false)
  const [permissionMenu, setPermissionMenu] = useState(false)
  const [models, setModels] = useState<PiModel[]>([])
  const [currentModel, setCurrentModel] = useState<PiModel | null>(null)
  const [thinkingLevels, setThinkingLevels] = useState<string[]>(['off'])
  const [thinkingLevel, setThinkingLevel] = useState('off')
  const [modelError, setModelError] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [permission, setPermission] = useState('默认权限')
  const [attachments, setAttachments] = useState<string[]>([])
  const [stream, setStream] = useState<Record<string, string>>({})
  const [working, setWorking] = useState<Record<string, boolean>>({})
  const [activity, setActivity] = useState<Record<string, string>>({})
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('pidesk.sidebar-width'))
    return saved >= 220 && saved <= 480 ? Math.round(saved) : 267
  })
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = Number(localStorage.getItem('pidesk.terminal-height'))
    return saved >= 150 && saved <= 600 ? Math.round(saved) : 250
  })
  const [resizing, setResizing] = useState<null | 'col' | 'row'>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'changes' | 'files'>('changes')
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showProjectMenu, setShowProjectMenu] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const resizeActive = useRef(false)
  const resizeOrigin = useRef(0)
  const resizeAxis = useRef<'col' | 'row'>('col')
  const selectedTask = useMemo(() => data.tasks.find(task => task.id === data.selectedTaskId) || null, [data])
  const selectedProject = useMemo(() => data.projects.find(project => project.id === data.selectedProjectId) || null, [data])

  const reload = useCallback(async () => setData(await window.desk.getData()), [])
  const refreshGit = useCallback(async (projectId: string) => {
    const overview = await window.desk.gitOverview(projectId)
    setGit(overview)
    setSelectedFile(current => overview.files.some(file => file.path === current) ? current : overview.files[0]?.path || null)
  }, [])

  useEffect(() => {
    reload()
    window.desk.piStatus().then(setPi)
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(value => !value) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); setSidebarOpen(value => !value) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); setTerminalOpen(value => !value) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); document.querySelector<HTMLButtonElement>('.new-task-button')?.click() }
      if (event.key === 'Escape') { setSearchOpen(false); setShowProjectMenu(false) }
    }
    window.addEventListener('keydown', onKey)
    const off = window.desk.onPiEvent((event: PiEvent) => {
      if (event.type === 'delta') setStream(old => ({ ...old, [event.taskId]: (old[event.taskId] || '') + (event.text || '') }))
      if (event.type === 'tool') setActivity(old => ({ ...old, [event.taskId]: event.text || '处理中' }))
      if (event.type === 'ready') setActivity(old => ({ ...old, [event.taskId]: '思考中' }))
      if (event.type === 'error') {
        setActivity(old => ({ ...old, [event.taskId]: event.text || '出了点问题' }))
        setWorking(old => ({ ...old, [event.taskId]: false }))
      }
      if (event.type === 'settled') {
        setStream(old => ({ ...old, [event.taskId]: '' }))
        setActivity(old => ({ ...old, [event.taskId]: '' }))
        setWorking(old => ({ ...old, [event.taskId]: false }))
        reload()
        const current = window.desk.getData().then(d => d.tasks.find(t => t.id === event.taskId)?.projectId)
        current.then(id => { if (id) refreshGit(id) })
      }
    })
    return () => { window.removeEventListener('keydown', onKey); off() }
  }, [reload, refreshGit])

  useEffect(() => { if (selectedProject) refreshGit(selectedProject.id); else setGit(emptyGit) }, [selectedProject?.id, refreshGit])
  useEffect(() => {
    if (!selectedProject || !selectedFile) { setDiff(''); return }
    window.desk.gitDiff(selectedProject.id, selectedFile).then(setDiff).catch(error => setDiff(String(error)))
  }, [selectedProject?.id, selectedFile, git.files.length])
  useEffect(() => chatEnd.current?.scrollIntoView({ behavior: 'smooth' }), [selectedTask?.messages.length, stream[selectedTask?.id || '']])
  useEffect(() => {
    if (!selectedProject) return
    const timer = window.setInterval(() => refreshGit(selectedProject.id), 8000)
    return () => window.clearInterval(timer)
  }, [selectedProject?.id, refreshGit])
  useEffect(() => {
    if (!modelMenu) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !modelMenuRef.current?.contains(event.target)) setModelMenu(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [modelMenu])

  useEffect(() => { localStorage.setItem('pidesk.sidebar-width', String(sidebarWidth)) }, [sidebarWidth])
  useEffect(() => { localStorage.setItem('pidesk.terminal-height', String(terminalHeight)) }, [terminalHeight])

  function clampSidebarWidth(width: number) { return Math.min(480, Math.max(220, Math.round(width))) }
  function clampTerminalHeight(height: number) { return Math.min(600, Math.max(150, Math.round(height))) }
  function onResizeStart(event: ReactPointerEvent<HTMLDivElement>, axis: 'col' | 'row') {
    event.preventDefault()
    resizeAxis.current = axis
    resizeOrigin.current = axis === 'col' ? event.clientX - sidebarWidth : event.clientY + terminalHeight
    resizeActive.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(axis)
  }
  function onResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeActive.current) return
    if (resizeAxis.current === 'col') setSidebarWidth(clampSidebarWidth(event.clientX - resizeOrigin.current))
    else setTerminalHeight(clampTerminalHeight(resizeOrigin.current - event.clientY))
  }
  function onResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeActive.current) return
    resizeActive.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setResizing(null)
  }

  async function addProject() { const project = await window.desk.addProject(); if (project) { await reload(); await refreshGit(project.id) } }
  async function newTask(projectId?: string) {
    const id = projectId || selectedProject?.id
    if (!id) { await addProject(); return }
    const task = await window.desk.newTask(id)
    await reload()
    setDraft('')
    setSelectedFile(null)
    return task
  }
  async function selectTask(task: Task) { await window.desk.selectTask(task.id); await reload(); setDraft('') }
  async function selectProject(project: Project) {
    const task = data.tasks.filter(item => item.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (task) await selectTask(task)
    else await newTask(project.id)
  }
  async function send(text = draft) {
    const content = text.trim()
    if (!content) return
    let task = selectedTask
    if (!task) {
      if (!selectedProject) { await addProject(); return }
      task = await newTask(selectedProject.id) || null
    }
    if (!task) return
    setDraft('')
    setAttachments([])
    setWorking(old => ({ ...old, [task!.id]: true }))
    setActivity(old => ({ ...old, [task!.id]: '正在启动 Pi' }))
    try { await window.desk.sendPrompt(task.id, content); await reload() }
    catch (error) { setActivity(old => ({ ...old, [task!.id]: String(error) })); setWorking(old => ({ ...old, [task!.id]: false })) }
  }
  async function deleteTask(task: Task) {
    modelCache.delete(task.id)
    await window.desk.deleteTask(task.id)
    await reload()
  }
  async function toggleModelMenu() {
    const opening = !modelMenu
    setModelMenu(opening)
    setModelError('')
    if (!opening || !selectedTask) return
    setModelSearch('')
    const cached = modelCache.get(selectedTask.id)
    if (cached) { setModels(cached.models); setCurrentModel(cached.current); setThinkingLevels(cached.thinkingLevels); setThinkingLevel(cached.thinkingLevel) }
    try {
      const state = await window.desk.getPiModels(selectedTask.id)
      modelCache.set(selectedTask.id, state)
      setModels(state.models)
      setCurrentModel(state.current)
      setThinkingLevels(state.thinkingLevels)
      setThinkingLevel(state.thinkingLevel)
    } catch (error) { if (!cached) setModelError(String(error)) }
  }

  const filteredTasks = data.tasks.filter(task => task.title.toLowerCase().includes(search.toLowerCase()) || data.projects.find(p => p.id === task.projectId)?.name.toLowerCase().includes(search.toLowerCase()))
  return <div className={`app-shell${resizing ? ` resizing ${resizing}` : ''}`}>
    {sidebarOpen && <aside className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-top drag-region"><div className="brand"><span className="brand-mark">π</span><span>Pi Desk</span></div><button className="icon-button no-drag" title="隐藏边栏 (⌘B)" onClick={() => setSidebarOpen(false)}><PanelRight size={16}/></button></div>
      <button className="new-task-button" onClick={() => newTask()}><Plus size={17}/><span>新建任务</span><span className="shortcut">⌘ N</span></button>
      <button className="sidebar-action" onClick={() => setSearchOpen(true)}><Search size={16}/><span>搜索任务</span><span className="shortcut">⌘ K</span></button>
      <div className="sidebar-scroll">
        <div className="section-heading"><span>工作区</span><button title="添加项目" onClick={addProject}><Plus size={15}/></button></div>
        {data.projects.length === 0 ? <div className="sidebar-hint">打开一个文件夹，开始与 Pi 协作。</div> : data.projects.map(project => {
          const tasks = data.tasks.filter(task => task.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt)
          return <div className="project-group" key={project.id}>
            <button className={`project-row ${selectedProject?.id === project.id ? 'active-project' : ''}`} onClick={() => selectProject(project)}>
              <ChevronDown size={13}/><span className="project-icon"><Folder size={14}/></span><span className="ellipsis">{project.name}</span><span className="project-count">{tasks.length}</span>
            </button>
            <div className="task-list">{tasks.map(task => <div className={`task-row-wrap ${selectedTask?.id === task.id ? 'selected' : ''}`} key={task.id}>
              <button className="task-row" onClick={() => selectTask(task)}><MessageCircle size={14}/><span className="ellipsis">{task.title}</span></button>
              <button className="task-delete" title="删除任务" onClick={() => deleteTask(task)}><X size={12}/></button>
            </div>)}</div>
          </div>
        })}
        <button className="add-project-link" onClick={addProject}><Plus size={15}/> 添加项目文件夹</button>
      </div>
      <div className="sidebar-footer">
        <div className={`status-dot ${pi.available ? 'online' : ''}`}/>
        <div className="status-copy" title={pi.detail}><strong>{pi.available ? 'Pi 已连接' : 'Pi 不可用'}</strong><span>{pi.detail}</span></div>
        <button className="icon-button" title="刷新 Pi 状态" onClick={() => window.desk.piStatus().then(setPi)}><RefreshCw size={14}/></button>
      </div>
      <div className="sidebar-resizer" title="拖动调整宽度 · 双击还原" onPointerDown={event => onResizeStart(event, 'col')} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onLostPointerCapture={onResizeEnd} onDoubleClick={() => setSidebarWidth(267)}/>
    </aside>}

    <main className="main-area">
      <header className="titlebar drag-region">
        <div className="titlebar-left no-drag">
          {!sidebarOpen && <button className="icon-button" title="显示边栏 (⌘B)" onClick={() => setSidebarOpen(true)}><PanelRight size={17}/></button>}
          <span className="breadcrumb">{selectedProject?.name || '工作区'}</span><ChevronRight size={14} className="breadcrumb-separator"/><strong>{selectedTask?.title || '新任务'}</strong>
        </div>
        <div className="titlebar-right no-drag">
          {selectedProject && <button className="branch-pill" onClick={() => window.desk.revealProject(selectedProject.id)} title="在访达中显示"><GitBranch size={14}/><span>{git.isRepository ? git.branch : selectedProject.name}</span></button>}
          <button className={`icon-button ${terminalOpen ? 'lit' : ''}`} title="切换终端 (⌘J)" onClick={() => setTerminalOpen(v => !v)}><PanelBottom size={17}/></button>
          <button className={`icon-button ${inspectorOpen ? 'lit' : ''}`} title="切换检查面板" onClick={() => setInspectorOpen(v => !v)}><PanelRight size={17}/></button>
        </div>
      </header>

      <div className="workspace-body">
        <section className="conversation-panel">
          <div className="conversation-main">
            {!selectedProject ? <Welcome onOpen={addProject}/> : !selectedTask || selectedTask.messages.length === 0 ? <TaskStart project={selectedProject} onPrompt={send}/> :
              <div className="messages-wrap"><div className="conversation-heading"><span className="eyebrow">任务</span><h1>{selectedTask.title}</h1><p>开始于 {shortTime(selectedTask.createdAt)} · {selectedProject.name}</p></div>
                <div className="messages">{selectedTask.messages.map(message => <div className={`message ${message.role}`} key={message.id}>
                  <div className="message-avatar">{message.role === 'user' ? 'Y' : 'π'}</div>
                  <div className="message-body"><div className="message-meta"><strong>{message.role === 'user' ? '我' : 'Pi'}</strong><span>{shortTime(message.createdAt)}</span></div><div className="message-content">{message.role === 'assistant' ? <Markdown text={message.text}/> : message.text}</div></div>
                </div>)}
                {working[selectedTask.id] && <div className="message assistant"><div className="message-avatar">π</div><div className="message-body"><div className="message-meta"><strong>Pi</strong><span className="thinking-indicator"><span/> {activity[selectedTask.id] || '思考中'}</span></div>{stream[selectedTask.id] && <div className="message-content"><Markdown text={stream[selectedTask.id]}/></div>}</div></div>}
                {!working[selectedTask.id] && activity[selectedTask.id] && <div className="inline-error">{activity[selectedTask.id]}</div>}
                <div ref={chatEnd}/></div>
              </div>}
          </div>
          {selectedProject && <div className="composer-area"><div className="composer">
            {attachments.length > 0 && <div className="composer-attachments">{attachments.map((file, index) => <span key={`${file}-${index}`}><FileCode2 size={13}/>{file}<button aria-label="移除附件" onClick={() => setAttachments(items => items.filter((_, i) => i !== index))}><X size={12}/></button></span>)}</div>}
            <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="随便问点什么，@ 提及文件，或输入 / 调用技能" rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }}/>
            <div className="composer-bottom">
              <div className="composer-tools">
                <button className="composer-icon" title="附加文件" onClick={() => window.desk.openFile(selectedProject.id).then(path => { if (path) setAttachments(items => [...items, path.split(/[\\/]/).pop() || path]) })}><Plus size={22}/></button>
                <div className="composer-menu-wrap"><button className="permission-control" onClick={() => setPermissionMenu(value => !value)}><Shield size={16}/><span>{permission}</span><ChevronDown size={13}/></button>{permissionMenu && <div className="composer-popover"><button onClick={() => { setPermission('默认权限'); setPermissionMenu(false) }}>默认权限</button><button onClick={() => { setPermission('每次确认'); setPermissionMenu(false) }}>每次确认</button></div>}</div>
              </div>
              <div className="composer-tools composer-tools-right">
                <div className="composer-menu-wrap" ref={modelMenuRef}><button className="model-control" onClick={toggleModelMenu}><span>{currentModel?.name || 'Pi 模型'}</span><span className="reasoning-label">{levelLabel(thinkingLevel)} 推理</span><ChevronDown size={13}/></button>{modelMenu && <div className="composer-popover model-popover"><div className="popover-label">Pi 模型 · 提供商</div><label className="model-search"><Search size={14}/><input autoFocus value={modelSearch} onChange={event => setModelSearch(event.target.value)} placeholder="搜索模型或提供商"/><kbd>⌘F</kbd></label>{modelError && <div className="model-error">{modelError}</div>}{models.length === 0 && !modelError && <div className="model-loading">正在读取 Pi 模型…</div>}{(() => { const query = modelSearch.trim().toLowerCase(); const filtered = models.filter(item => `${item.name} ${item.provider} ${item.id}`.toLowerCase().includes(query)); return filtered.length ? filtered.map(item => <button key={`${item.provider}/${item.id}`} className={currentModel?.provider === item.provider && currentModel.id === item.id ? 'selected' : ''} onClick={async () => { if (!selectedTask) return; try { const result = await window.desk.setPiModel(selectedTask.id, item.provider, item.id); const cached = modelCache.get(selectedTask.id); if (cached) modelCache.set(selectedTask.id, { ...cached, current: result.model, thinkingLevel: result.thinkingLevel, thinkingLevels: result.thinkingLevels }); setCurrentModel(result.model); setThinkingLevels(result.thinkingLevels); setThinkingLevel(result.thinkingLevel); setModelMenu(false) } catch (error) { setModelError(String(error)) } }}><span className="model-option"><strong>{item.name}</strong><small>{item.provider} · {item.id}</small></span>{currentModel?.provider === item.provider && currentModel.id === item.id && <Check size={13}/>}</button>) : models.length > 0 && <div className="model-loading">没有匹配的模型</div> })()}{thinkingLevels.length > 0 && <><div className="popover-label">推理强度</div>{thinkingLevels.map(level => <button key={level} className={thinkingLevel === level ? 'selected' : ''} onClick={async () => { if (!selectedTask) return; try { await window.desk.setPiThinkingLevel(selectedTask.id, level); setThinkingLevel(level); const cached = modelCache.get(selectedTask.id); if (cached) modelCache.set(selectedTask.id, { ...cached, thinkingLevel: level }) } catch (error) { setModelError(String(error)) } }}>{levelLabel(level)}{thinkingLevel === level && <Check size={13}/>}</button>)}</>}</div>}</div>
                <button className="composer-icon mic-control" title="语音输入（即将推出）" disabled><Mic size={19}/></button>
                {selectedTask && working[selectedTask.id] ? <button className="send-button stop" title="停止 Pi" onClick={() => window.desk.stopPrompt(selectedTask.id)}><Square size={13} fill="currentColor"/></button> : <button className="send-button" title="发送消息" disabled={!draft.trim()} onClick={() => send()}><ArrowUp size={20}/></button>}
              </div>
            </div>
          </div></div>}
          {terminalOpen && selectedProject && <TerminalPanel project={selectedProject} height={terminalHeight} onClose={() => setTerminalOpen(false)} onResizeStart={event => onResizeStart(event, 'row')} onResizeMove={onResizeMove} onResizeEnd={onResizeEnd} onReset={() => setTerminalHeight(250)}/>}
        </section>

        {inspectorOpen && <aside className="inspector">
          <div className="inspector-header"><div className="inspector-tabs"><button className={inspectorTab === 'changes' ? 'current' : ''} onClick={() => setInspectorTab('changes')}>变更 {git.files.length > 0 && <span className="tab-count">{git.files.length}</span>}</button><button className={inspectorTab === 'files' ? 'current' : ''} onClick={() => setInspectorTab('files')}>文件</button></div><button className="icon-button" title="刷新变更" onClick={() => selectedProject && refreshGit(selectedProject.id)}><RefreshCw size={14}/></button></div>
          {!selectedProject ? <div className="inspector-empty"><FileDiff size={25}/><strong>未打开项目</strong><span>项目中的更改将显示在这里。</span></div> : inspectorTab === 'changes' ? <>
            <div className="change-summary"><div><span className="eyebrow">工作树</span><strong>{git.isRepository ? `更改了 ${git.files.length} 个文件` : '非 Git 仓库'}</strong></div><span className="summary-badge"><GitBranch size={13}/>{git.isRepository ? git.branch : '—'}</span></div>
            {git.files.length === 0 ? <div className="inspector-empty changes-empty"><span className="clean-check"><Check size={20}/></span><strong>一切正常</strong><span>{git.isRepository ? '没有待审查的本地更改。' : '在此文件夹初始化 Git 后即可审查更改。'}</span></div> : <>
              <div className="file-list-label">已更改文件 <span>{git.files.length}</span></div>
              <div className="changed-files">{git.files.map(file => <FileRow key={file.path} file={file} active={selectedFile === file.path} onClick={() => setSelectedFile(file.path)}/>)}</div>
              <div className="diff-title"><FileCode2 size={15}/><span className="ellipsis">{selectedFile || '选择一个文件'}</span><span className="diff-title-label">差异</span></div>
              <DiffView diff={diff}/>
            </>}
          </> : <FilesView project={selectedProject} onReveal={() => window.desk.revealProject(selectedProject.id)}/>}
        </aside>}
      </div>
    </main>

    {searchOpen && <div className="modal-backdrop" onMouseDown={() => setSearchOpen(false)}><div className="search-modal" onMouseDown={e => e.stopPropagation()}><div className="search-field"><Search size={19}/><input autoFocus placeholder="搜索任务或项目…" value={search} onChange={e => setSearch(e.target.value)}/><kbd>esc</kbd></div><div className="search-results">{filteredTasks.length === 0 ? <div className="search-empty">没有匹配的任务</div> : filteredTasks.map(task => <button key={task.id} onClick={async () => { await selectTask(task); setSearchOpen(false) }}><MessageCircle size={16}/><span>{task.title}<small>{data.projects.find(p => p.id === task.projectId)?.name}</small></span><ArrowRight size={15}/></button>)}</div></div></div>}
  </div>
}

function Welcome({ onOpen }: { onOpen: () => void }) {
  return <div className="welcome"><div className="welcome-visual"><span>π</span><i className="orbit orbit-one"/><i className="orbit orbit-two"/></div><div className="eyebrow">你的编程工作区</div><h1>构建<br/><em>非凡之作。</em></h1><p>打开项目文件夹，开始与 Pi 协作。对话、代码变更与终端，尽在一处。</p><button className="primary-button" onClick={onOpen}><FolderOpen size={17}/> 打开项目 <ArrowRight size={16}/></button><div className="welcome-foot">本地项目 <span>·</span> 任务持久 <span>·</span> 为 Mac 而生</div></div>
}

function TaskStart({ project, onPrompt }: { project: Project; onPrompt: (text: string) => void }) {
  const suggestions = [
    { icon: <Sparkles size={17}/>, title: '探索这个代码库', prompt: '探索这个代码库，解释它的整体架构、主要组成部分，以及如何运行它。' },
    { icon: <CircleHelp size={17}/>, title: '寻找改进点', prompt: '审查这个项目，提出下一步最有价值的一个小改进。' },
    { icon: <Code2 size={17}/>, title: '开发新功能', prompt: '帮我在这个项目中规划并实现一个新功能。' }
  ]
  return <div className="task-start"><div className="task-start-icon"><span>π</span></div><span className="eyebrow">随时开始</span><h1>我们来做点什么？</h1><p>Pi 已准备好在 <strong>{project.name}</strong> 中工作。在下方描述任务，或从这些建议开始。</p><div className="suggestions">{suggestions.map(item => <button key={item.title} onClick={() => onPrompt(item.prompt)}><span>{item.icon}</span><strong>{item.title}</strong><ArrowRight size={15}/></button>)}</div></div>
}

function FileRow({ file, active, onClick }: { file: GitFile; active: boolean; onClick: () => void }) {
  const name = file.path.split('/').pop()
  const parent = file.path.includes('/') ? file.path.slice(0, -(name?.length || 0)) : ''
  const code = file.status === '??' ? 'U' : file.status.includes('D') ? 'D' : file.status.includes('A') ? 'A' : 'M'
  return <button className={`file-row ${active ? 'active' : ''}`} onClick={onClick}><span className={`file-status status-${code}`}>{code}</span><span className="file-name"><strong>{name}</strong><small>{parent}</small></span><span className="file-stats"><i>+{file.additions}</i><b>−{file.deletions}</b></span></button>
}

function DiffView({ diff }: { diff: string }) {
  if (!diff) return <div className="diff-empty">选择一个已更改的文件即可查看差异。</div>
  return <div className="diff-scroll"><div className="diff-code">{diff.split('\n').map((line, index) => {
    const type = line.startsWith('+++') || line.startsWith('---') ? 'meta' : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : line.startsWith('@@') ? 'hunk' : line.startsWith('diff ') || line.startsWith('index ') ? 'meta' : 'context'
    return <div className={`diff-line ${type}`} key={index}><span className="diff-gutter">{type === 'added' ? '+' : type === 'removed' ? '−' : ''}</span><span>{line || ' '}</span></div>
  })}</div></div>
}

function FilesView({ project, onReveal }: { project: Project; onReveal: () => void }) {
  const [folder, setFolder] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [file, setFile] = useState('')
  const [content, setContent] = useState('')
  useEffect(() => { setFolder(''); setFile(''); setContent('') }, [project.id])
  useEffect(() => { window.desk.listFiles(project.id, folder).then(setEntries).catch(() => setEntries([])) }, [project.id, folder])
  async function open(entry: FileEntry) {
    if (entry.isDirectory) { setFolder(entry.path); setFile(''); setContent('') }
    else { setFile(entry.path); try { setContent(await window.desk.readFile(project.id, entry.path)) } catch (error) { setContent(String(error)) } }
  }
  const parent = folder.split('/').slice(0, -1).join('/')
  return <div className="files-pane">
    <div className="file-browser-head"><div><FolderOpen size={16}/><strong>{project.name}</strong></div><button className="icon-button" title="在访达中显示" onClick={onReveal}><ArrowRight size={14}/></button></div>
    <div className="file-browser-path"><button onClick={() => { setFolder(''); setFile('') }}>根目录</button>{folder && <> / <button onClick={() => { setFolder(parent); setFile('') }}>{folder}</button></>}</div>
    <div className="file-browser-list">{folder && <button className="browser-entry" onClick={() => { setFolder(parent); setFile('') }}><ArrowLeft size={14}/><span>..</span></button>}{entries.map(entry => <button className={`browser-entry ${file === entry.path ? 'selected' : ''}`} key={entry.path} onClick={() => open(entry)}>{entry.isDirectory ? <Folder size={14}/> : <FileCode2 size={14}/>}<span className="ellipsis">{entry.name}</span>{entry.isDirectory && <ChevronRight size={12}/>}</button>)}</div>
    {file ? <><div className="source-title"><FileCode2 size={14}/><span className="ellipsis">{file}</span></div><div className="source-scroll">{content.split('\n').map((line, index) => <div className="source-line" key={index}><span>{index + 1}</span><code>{line || ' '}</code></div>)}</div></> : <div className="file-browser-empty">选择一个文件即可预览内容。</div>}
  </div>
}

function TerminalPanel({ project, onClose, height, onResizeStart, onResizeMove, onResizeEnd, onReset }: { project: Project; onClose: () => void; height: number; onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void; onResizeMove: (event: ReactPointerEvent<HTMLDivElement>) => void; onResizeEnd: (event: ReactPointerEvent<HTMLDivElement>) => void; onReset: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  useEffect(() => {
    if (!host.current) return
    const terminal = new Terminal({ theme: { background: '#101216', foreground: '#d5d7dc', cursor: '#e8c37e', selectionBackground: '#53617a66', black: '#15171d', green: '#90c6a3', red: '#dc8f8e', yellow: '#e8c37e', blue: '#94addd', magenta: '#c3a1d9', cyan: '#9ac9d0', white: '#d5d7dc' }, fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.45, cursorBlink: true, scrollback: 5000, convertEol: true })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current)
    fit.fit()
    term.current = terminal
    const off = window.desk.onTerminalData(event => { if (event.projectId === project.id) terminal.write(event.data) })
    const input = terminal.onData(text => window.desk.terminalWrite(project.id, text))
    const observer = new ResizeObserver(() => { fit.fit(); window.desk.terminalResize(project.id, terminal.cols, terminal.rows) })
    observer.observe(host.current)
    window.desk.terminalStart(project.id).then(history => { window.desk.terminalResize(project.id, terminal.cols, terminal.rows); if (history) terminal.write(history) })
    return () => { off(); input.dispose(); observer.disconnect(); terminal.dispose(); term.current = null }
  }, [project.id])
  return <div className="terminal-panel" style={{ height }}><div className="terminal-resizer" title="拖动调整高度 · 双击还原" onPointerDown={onResizeStart} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onLostPointerCapture={onResizeEnd} onDoubleClick={onReset}/><div className="terminal-header"><div><TerminalIcon size={14}/><strong>终端</strong><span className="terminal-project">zsh · {project.name}</span></div><button className="icon-button" title="关闭终端" onClick={onClose}><X size={15}/></button></div><div className="terminal-host" ref={host}/></div>
}

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) return <span className="md-link" title={link[2]} key={index}>{link[1]}</span>
    return part
  })
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim().replace(/\\\|/g, '\u0000')
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map(cell => cell.trim().replace(/\u0000/g, '|'))
}

function tableAlignment(delimiter: string): ('left' | 'center' | 'right')[] | null {
  const cells = splitTableRow(delimiter)
  if (!cells.length || !cells.every(cell => /^:?-+:?$/.test(cell))) return null
  return cells.map(cell => (cell.startsWith(':') && cell.endsWith(':')) ? 'center' : cell.endsWith(':') ? 'right' : 'left')
}

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let listOrdered = false
  const flushParagraph = () => { if (paragraph.length) { blocks.push(<p key={blocks.length}>{inlineMarkdown(paragraph.join(' '))}</p>); paragraph = [] } }
  const flushList = () => { if (list.length) { const items = list.map((item, i) => <li key={i}>{inlineMarkdown(item)}</li>); blocks.push(listOrdered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>); list = [] } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^```\s*(.*)$/)
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    const bullet = line.match(/^\s*([-*]|\d+\.)\s+(.+)$/)
    if (fence) {
      flushParagraph(); flushList()
      const code: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i])
      blocks.push(<div className="md-code-block" key={blocks.length}><div>{fence[1] || 'code'}</div><pre>{code.join('\n')}</pre></div>)
    } else if (heading) {
      flushParagraph(); flushList()
      const level = Math.min(heading[1].length, 4)
      blocks.push(<div className={`md-heading md-h${level}`} key={blocks.length}>{inlineMarkdown(heading[2])}</div>)
    } else if (line.includes('|') && i + 1 < lines.length) {
      const align = tableAlignment(lines[i + 1])
      const header = align ? splitTableRow(line) : null
      if (align && header && align.length === header.length) {
        flushParagraph(); flushList()
        i += 2
        const rows: string[][] = []
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitTableRow(lines[i])); i++ }
        i--
        blocks.push(<div className="md-table-wrap" key={blocks.length}><table className="md-table">
          <thead><tr>{header.map((cell, c) => <th key={c} style={{ textAlign: align[c] }}>{inlineMarkdown(cell)}</th>)}</tr></thead>
          <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} style={{ textAlign: align[c] }}>{inlineMarkdown(cell)}</td>)}</tr>)}</tbody>
        </table></div>)
      } else { flushList(); paragraph.push(line) }
    } else if (bullet) {
      flushParagraph()
      const ordered = /\d/.test(bullet[1][0])
      if (list.length && listOrdered !== ordered) flushList()
      listOrdered = ordered
      list.push(bullet[2])
    } else if (line.startsWith('> ')) {
      flushParagraph(); flushList()
      blocks.push(<blockquote key={blocks.length}>{inlineMarkdown(line.slice(2))}</blockquote>)
    } else if (/^---+$/.test(line.trim())) {
      flushParagraph(); flushList(); blocks.push(<hr key={blocks.length}/>)
    } else if (!line.trim()) { flushParagraph(); flushList() }
    else { flushList(); paragraph.push(line) }
  }
  flushParagraph(); flushList()
  return <div className="markdown">{blocks}</div>
}

export default App
