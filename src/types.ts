export type Message = { id: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt: number }
export type Task = { id: string; projectId: string; title: string; createdAt: number; updatedAt: number; messages: Message[] }
export type Project = { id: string; name: string; path: string; createdAt: number }
export type AppData = { projects: Project[]; tasks: Task[]; selectedTaskId: string | null; selectedProjectId: string | null }
export type GitFile = { path: string; status: string; additions: number; deletions: number }
export type GitOverview = { branch: string; files: GitFile[]; isRepository: boolean }
export type FileEntry = { path: string; name: string; isDirectory: boolean }
export type PiStatus = { available: boolean; detail: string }
export type PiEvent = { taskId: string; type: 'delta' | 'settled' | 'error' | 'tool' | 'ready'; text?: string }

export interface DeskAPI {
  getData(): Promise<AppData>
  addProject(): Promise<Project | null>
  newTask(projectId: string): Promise<Task>
  selectTask(taskId: string): Promise<void>
  updateTask(task: Task): Promise<void>
  deleteTask(taskId: string): Promise<void>
  piStatus(): Promise<PiStatus>
  sendPrompt(taskId: string, text: string): Promise<void>
  stopPrompt(taskId: string): Promise<void>
  onPiEvent(handler: (event: PiEvent) => void): () => void
  gitOverview(projectId: string): Promise<GitOverview>
  gitDiff(projectId: string, path: string): Promise<string>
  listFiles(projectId: string, path: string): Promise<FileEntry[]>
  readFile(projectId: string, path: string): Promise<string>
  terminalStart(projectId: string): Promise<string>
  terminalWrite(projectId: string, text: string): Promise<void>
  terminalResize(projectId: string, cols: number, rows: number): Promise<void>
  onTerminalData(handler: (event: { projectId: string; data: string }) => void): () => void
  revealProject(projectId: string): Promise<void>
}
