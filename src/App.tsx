import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight,
  CircleHelp, Code2, Command, FileCode2, FileDiff, Folder, FolderOpen,
  GitBranch, GitPullRequest, PanelRight, MessageCircle, MoreHorizontal,
  PanelBottom, Plus, RefreshCw, Search, Send, Settings2, Sparkles, Square,
  Terminal as TerminalIcon, Trash2, X
} from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { AppData, FileEntry, GitFile, GitOverview, PiEvent, PiStatus, Project, Task } from './types'

const emptyData: AppData = { projects: [], tasks: [], selectedProjectId: null, selectedTaskId: null }
const emptyGit: GitOverview = { branch: '', files: [], isRepository: false }

function shortTime(value: number): string {
  const date = new Date(value)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function App() {
  const [data, setData] = useState<AppData>(emptyData)
  const [pi, setPi] = useState<PiStatus>({ available: false, detail: 'Checking Pi…' })
  const [git, setGit] = useState<GitOverview>(emptyGit)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [draft, setDraft] = useState('')
  const [stream, setStream] = useState<Record<string, string>>({})
  const [working, setWorking] = useState<Record<string, boolean>>({})
  const [activity, setActivity] = useState<Record<string, string>>({})
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'changes' | 'files'>('changes')
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showProjectMenu, setShowProjectMenu] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)
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
      if (event.type === 'tool') setActivity(old => ({ ...old, [event.taskId]: event.text || 'Working' }))
      if (event.type === 'ready') setActivity(old => ({ ...old, [event.taskId]: 'Thinking' }))
      if (event.type === 'error') {
        setActivity(old => ({ ...old, [event.taskId]: event.text || 'Something went wrong' }))
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
    setWorking(old => ({ ...old, [task!.id]: true }))
    setActivity(old => ({ ...old, [task!.id]: 'Starting Pi' }))
    try { await window.desk.sendPrompt(task.id, content); await reload() }
    catch (error) { setActivity(old => ({ ...old, [task!.id]: String(error) })); setWorking(old => ({ ...old, [task!.id]: false })) }
  }
  async function deleteTask(task: Task) {
    await window.desk.deleteTask(task.id)
    await reload()
  }

  const filteredTasks = data.tasks.filter(task => task.title.toLowerCase().includes(search.toLowerCase()) || data.projects.find(p => p.id === task.projectId)?.name.toLowerCase().includes(search.toLowerCase()))
  return <div className="app-shell">
    {sidebarOpen && <aside className="sidebar">
      <div className="sidebar-top drag-region"><div className="brand"><span className="brand-mark">π</span><span>Pi Desk</span></div><button className="icon-button no-drag" title="Hide sidebar (⌘B)" onClick={() => setSidebarOpen(false)}><PanelRight size={16}/></button></div>
      <button className="new-task-button" onClick={() => newTask()}><Plus size={17}/><span>New task</span><span className="shortcut">⌘ N</span></button>
      <button className="sidebar-action" onClick={() => setSearchOpen(true)}><Search size={16}/><span>Search tasks</span><span className="shortcut">⌘ K</span></button>
      <div className="sidebar-scroll">
        <div className="section-heading"><span>WORKSPACES</span><button title="Add project" onClick={addProject}><Plus size={15}/></button></div>
        {data.projects.length === 0 ? <div className="sidebar-hint">Open a folder to start working with Pi.</div> : data.projects.map(project => {
          const tasks = data.tasks.filter(task => task.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt)
          return <div className="project-group" key={project.id}>
            <button className={`project-row ${selectedProject?.id === project.id ? 'active-project' : ''}`} onClick={() => selectProject(project)}>
              <ChevronDown size={13}/><span className="project-icon"><Folder size={14}/></span><span className="ellipsis">{project.name}</span><span className="project-count">{tasks.length}</span>
            </button>
            <div className="task-list">{tasks.map(task => <div className={`task-row-wrap ${selectedTask?.id === task.id ? 'selected' : ''}`} key={task.id}>
              <button className="task-row" onClick={() => selectTask(task)}><MessageCircle size={14}/><span className="ellipsis">{task.title}</span></button>
              <button className="task-delete" title="Delete task" onClick={() => deleteTask(task)}><X size={12}/></button>
            </div>)}</div>
          </div>
        })}
        <button className="add-project-link" onClick={addProject}><Plus size={15}/> Add project folder</button>
      </div>
      <div className="sidebar-footer">
        <div className={`status-dot ${pi.available ? 'online' : ''}`}/>
        <div className="status-copy" title={pi.detail}><strong>{pi.available ? 'Pi connected' : 'Pi unavailable'}</strong><span>{pi.detail}</span></div>
        <button className="icon-button" title="Refresh Pi status" onClick={() => window.desk.piStatus().then(setPi)}><RefreshCw size={14}/></button>
      </div>
    </aside>}

    <main className="main-area">
      <header className="titlebar drag-region">
        <div className="titlebar-left no-drag">
          {!sidebarOpen && <button className="icon-button" title="Show sidebar (⌘B)" onClick={() => setSidebarOpen(true)}><PanelRight size={17}/></button>}
          <span className="breadcrumb">{selectedProject?.name || 'Workspace'}</span><ChevronRight size={14} className="breadcrumb-separator"/><strong>{selectedTask?.title || 'New task'}</strong>
        </div>
        <div className="titlebar-right no-drag">
          {selectedProject && <button className="branch-pill" onClick={() => window.desk.revealProject(selectedProject.id)} title="Reveal project in Finder"><GitBranch size={14}/><span>{git.isRepository ? git.branch : selectedProject.name}</span></button>}
          <button className={`icon-button ${terminalOpen ? 'lit' : ''}`} title="Toggle terminal (⌘J)" onClick={() => setTerminalOpen(v => !v)}><PanelBottom size={17}/></button>
          <button className={`icon-button ${inspectorOpen ? 'lit' : ''}`} title="Toggle review pane" onClick={() => setInspectorOpen(v => !v)}><PanelRight size={17}/></button>
        </div>
      </header>

      <div className="workspace-body">
        <section className="conversation-panel">
          <div className="conversation-main">
            {!selectedProject ? <Welcome onOpen={addProject}/> : !selectedTask || selectedTask.messages.length === 0 ? <TaskStart project={selectedProject} onPrompt={send}/> :
              <div className="messages-wrap"><div className="conversation-heading"><span className="eyebrow">TASK</span><h1>{selectedTask.title}</h1><p>Started {shortTime(selectedTask.createdAt)} · {selectedProject.name}</p></div>
                <div className="messages">{selectedTask.messages.map(message => <div className={`message ${message.role}`} key={message.id}>
                  <div className="message-avatar">{message.role === 'user' ? 'Y' : 'π'}</div>
                  <div className="message-body"><div className="message-meta"><strong>{message.role === 'user' ? 'You' : 'Pi'}</strong><span>{shortTime(message.createdAt)}</span></div><div className="message-content">{message.role === 'assistant' ? <Markdown text={message.text}/> : message.text}</div></div>
                </div>)}
                {working[selectedTask.id] && <div className="message assistant"><div className="message-avatar">π</div><div className="message-body"><div className="message-meta"><strong>Pi</strong><span className="thinking-indicator"><span/> {activity[selectedTask.id] || 'Thinking'}</span></div>{stream[selectedTask.id] && <div className="message-content"><Markdown text={stream[selectedTask.id]}/></div>}</div></div>}
                {!working[selectedTask.id] && activity[selectedTask.id] && <div className="inline-error">{activity[selectedTask.id]}</div>}
                <div ref={chatEnd}/></div>
              </div>}
          </div>
          {selectedProject && <div className="composer-area"><div className="composer">
            <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask Pi to build, fix, or explore…" rows={3} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }}/>
            <div className="composer-bottom"><div className="composer-context"><span className="model-icon">π</span><span>Pi</span><ChevronDown size={12}/><span className="composer-divider"/><Folder size={13}/><span className="ellipsis">{selectedProject.name}</span></div>
              {selectedTask && working[selectedTask.id] ? <button className="send-button stop" title="Stop Pi" onClick={() => window.desk.stopPrompt(selectedTask.id)}><Square size={13} fill="currentColor"/></button> : <button className="send-button" title="Send message" disabled={!draft.trim()} onClick={() => send()}><ArrowUp size={17}/></button>}
            </div>
          </div><div className="composer-note">Pi can read and edit files in this project. Review changes before committing.</div></div>}
          {terminalOpen && selectedProject && <TerminalPanel project={selectedProject} onClose={() => setTerminalOpen(false)}/>}
        </section>

        {inspectorOpen && <aside className="inspector">
          <div className="inspector-header"><div className="inspector-tabs"><button className={inspectorTab === 'changes' ? 'current' : ''} onClick={() => setInspectorTab('changes')}>Changes {git.files.length > 0 && <span className="tab-count">{git.files.length}</span>}</button><button className={inspectorTab === 'files' ? 'current' : ''} onClick={() => setInspectorTab('files')}>Files</button></div><button className="icon-button" title="Refresh changes" onClick={() => selectedProject && refreshGit(selectedProject.id)}><RefreshCw size={14}/></button></div>
          {!selectedProject ? <div className="inspector-empty"><FileDiff size={25}/><strong>No project open</strong><span>Changes in your project will appear here.</span></div> : inspectorTab === 'changes' ? <>
            <div className="change-summary"><div><span className="eyebrow">WORKING TREE</span><strong>{git.isRepository ? `${git.files.length} changed ${git.files.length === 1 ? 'file' : 'files'}` : 'No Git repository'}</strong></div><span className="summary-badge"><GitBranch size={13}/>{git.isRepository ? git.branch : '—'}</span></div>
            {git.files.length === 0 ? <div className="inspector-empty changes-empty"><span className="clean-check"><Check size={20}/></span><strong>All clear</strong><span>{git.isRepository ? 'No local changes to review.' : 'Initialize Git in this folder to review changes.'}</span></div> : <>
              <div className="file-list-label">CHANGED FILES <span>{git.files.length}</span></div>
              <div className="changed-files">{git.files.map(file => <FileRow key={file.path} file={file} active={selectedFile === file.path} onClick={() => setSelectedFile(file.path)}/>)}</div>
              <div className="diff-title"><FileCode2 size={15}/><span className="ellipsis">{selectedFile || 'Select a file'}</span><span className="diff-title-label">DIFF</span></div>
              <DiffView diff={diff}/>
            </>}
          </> : <FilesView project={selectedProject} onReveal={() => window.desk.revealProject(selectedProject.id)}/>}
        </aside>}
      </div>
    </main>

    {searchOpen && <div className="modal-backdrop" onMouseDown={() => setSearchOpen(false)}><div className="search-modal" onMouseDown={e => e.stopPropagation()}><div className="search-field"><Search size={19}/><input autoFocus placeholder="Search tasks or projects…" value={search} onChange={e => setSearch(e.target.value)}/><kbd>esc</kbd></div><div className="search-results">{filteredTasks.length === 0 ? <div className="search-empty">No matching tasks</div> : filteredTasks.map(task => <button key={task.id} onClick={async () => { await selectTask(task); setSearchOpen(false) }}><MessageCircle size={16}/><span>{task.title}<small>{data.projects.find(p => p.id === task.projectId)?.name}</small></span><ArrowRight size={15}/></button>)}</div></div></div>}
  </div>
}

function Welcome({ onOpen }: { onOpen: () => void }) {
  return <div className="welcome"><div className="welcome-visual"><span>π</span><i className="orbit orbit-one"/><i className="orbit orbit-two"/></div><div className="eyebrow">YOUR CODING WORKSPACE</div><h1>Build something<br/><em>remarkable.</em></h1><p>Open a project folder to start working with Pi. Your conversations, code changes, and terminal stay together in one place.</p><button className="primary-button" onClick={onOpen}><FolderOpen size={17}/> Open a project <ArrowRight size={16}/></button><div className="welcome-foot">LOCAL PROJECTS <span>·</span> PERSISTENT TASKS <span>·</span> BUILT FOR MAC</div></div>
}

function TaskStart({ project, onPrompt }: { project: Project; onPrompt: (text: string) => void }) {
  const suggestions = [
    { icon: <Sparkles size={17}/>, title: 'Explore this codebase', prompt: 'Explore this codebase and explain its architecture, main components, and how to run it.' },
    { icon: <CircleHelp size={17}/>, title: 'Find something to improve', prompt: 'Review this project and suggest the most valuable small improvement to make next.' },
    { icon: <Code2 size={17}/>, title: 'Build a feature', prompt: 'Help me plan and implement a new feature in this project.' }
  ]
  return <div className="task-start"><div className="task-start-icon"><span>π</span></div><span className="eyebrow">READY WHEN YOU ARE</span><h1>What are we building?</h1><p>Pi is ready to work in <strong>{project.name}</strong>. Describe a task below, or start with one of these.</p><div className="suggestions">{suggestions.map(item => <button key={item.title} onClick={() => onPrompt(item.prompt)}><span>{item.icon}</span><strong>{item.title}</strong><ArrowRight size={15}/></button>)}</div></div>
}

function FileRow({ file, active, onClick }: { file: GitFile; active: boolean; onClick: () => void }) {
  const name = file.path.split('/').pop()
  const parent = file.path.includes('/') ? file.path.slice(0, -(name?.length || 0)) : ''
  const code = file.status === '??' ? 'U' : file.status.includes('D') ? 'D' : file.status.includes('A') ? 'A' : 'M'
  return <button className={`file-row ${active ? 'active' : ''}`} onClick={onClick}><span className={`file-status status-${code}`}>{code}</span><span className="file-name"><strong>{name}</strong><small>{parent}</small></span><span className="file-stats"><i>+{file.additions}</i><b>−{file.deletions}</b></span></button>
}

function DiffView({ diff }: { diff: string }) {
  if (!diff) return <div className="diff-empty">Select a changed file to see its diff.</div>
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
    <div className="file-browser-head"><div><FolderOpen size={16}/><strong>{project.name}</strong></div><button className="icon-button" title="Reveal in Finder" onClick={onReveal}><ArrowRight size={14}/></button></div>
    <div className="file-browser-path"><button onClick={() => { setFolder(''); setFile('') }}>root</button>{folder && <> / <button onClick={() => { setFolder(parent); setFile('') }}>{folder}</button></>}</div>
    <div className="file-browser-list">{folder && <button className="browser-entry" onClick={() => { setFolder(parent); setFile('') }}><ArrowLeft size={14}/><span>..</span></button>}{entries.map(entry => <button className={`browser-entry ${file === entry.path ? 'selected' : ''}`} key={entry.path} onClick={() => open(entry)}>{entry.isDirectory ? <Folder size={14}/> : <FileCode2 size={14}/>}<span className="ellipsis">{entry.name}</span>{entry.isDirectory && <ChevronRight size={12}/>}</button>)}</div>
    {file ? <><div className="source-title"><FileCode2 size={14}/><span className="ellipsis">{file}</span></div><div className="source-scroll">{content.split('\n').map((line, index) => <div className="source-line" key={index}><span>{index + 1}</span><code>{line || ' '}</code></div>)}</div></> : <div className="file-browser-empty">Select a file to preview its contents.</div>}
  </div>
}

function TerminalPanel({ project, onClose }: { project: Project; onClose: () => void }) {
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
  return <div className="terminal-panel"><div className="terminal-header"><div><TerminalIcon size={14}/><strong>Terminal</strong><span className="terminal-project">zsh · {project.name}</span></div><button className="icon-button" title="Close terminal" onClick={onClose}><X size={15}/></button></div><div className="terminal-host" ref={host}/></div>
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
