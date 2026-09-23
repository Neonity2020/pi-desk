# Pi Desk

A macOS desktop workspace for the Pi coding agent, built with Bun, Electron, React, and TypeScript.

Open a project folder, create persistent tasks, chat with Pi, review Git changes, browse source files, and use the integrated zsh terminal. Each task has its own persistent Pi session.

## Start

Requirements: macOS, [Bun](https://bun.sh/), [Pi](https://pi.dev/docs/latest/quickstart), and a Node.js version supported by your Pi installation. Sign in to a model provider using Pi before sending a task.

```sh
bun install
bun run dev
```

To build and open the production app:

```sh
bun run package:mac
open "release/Pi Desk.app"
```

The app package is built locally and ad hoc signed. It is not notarized for distribution. If macOS blocks it, run from the source project with `bun run dev` or approve the app in macOS privacy and security settings.

## How it works

- Project and task metadata plus visible conversation history are saved to the app's user data folder (`~/Library/Application Support/PiDesk`).
- Every task starts Pi in [RPC mode](https://pi.dev/docs/latest/rpc) with its own `--session-id`; Pi's session files are saved under `pi-sessions` in the same user data folder.
- Git change counts and diffs come from local `git` commands. The Changes pane updates after a Pi run and periodically while a project is open.
- The Files pane offers a read-only source preview. File editing is handled by Pi or the integrated terminal.
- The terminal runs the user's zsh in the selected project folder and keeps its process alive while the pane is hidden.

The app has no built-in model authentication screen; Pi uses its existing local credentials and configuration. The included PTY runtime and `.app` target Apple Silicon Macs. The Pi status indicator confirms that the CLI is available, while model sign-in is checked by Pi when a task runs.
