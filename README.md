# ComicTerm

A tabbed terminal emulator built on [Electron](https://www.electronjs.org/),
[xterm.js](https://xtermjs.org/) and [node-pty](https://github.com/microsoft/node-pty).
Runs on Windows, macOS and Linux.

## Run

```sh
npm install
npm start
```

`npm install` compiles node-pty, so you need a working C++ toolchain: Xcode
Command Line Tools on macOS, `build-essential` and `python3` on Linux, or the
"Desktop development with C++" workload from Visual Studio Build Tools on
Windows.

## Features

- **Tabs**, each running its own shell. Click `+`, middle-click or `✕` to close.
- **Tab titles follow the shell** — the title escape sequences your prompt
  already emits show up as the tab label and the window title.
- **Live font control.** Type a family into the box at top right; `Ctrl`/`Cmd`
  and `+`/`-` resize. Both settings survive a restart.
- **256-colour and truecolour** output (`TERM=xterm-256color`, `COLORTERM=truecolor`).
- **10,000 lines of scrollback** per tab.

### Keyboard shortcuts

macOS uses `Cmd`; Windows and Linux use `Ctrl+Shift`, which keeps `Ctrl+C`
free for sending SIGINT.

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| New tab | `Cmd+T` | `Ctrl+Shift+T` |
| Close tab | `Cmd+W` | `Ctrl+Shift+W` |
| Copy selection | `Cmd+C` | `Ctrl+Shift+C` |
| Paste | `Cmd+V` | `Ctrl+Shift+V` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Jump to tab 1–8, last | `Cmd+1`…`Cmd+9` | `Alt+1`…`Alt+9` |
| Zoom in / out / reset | `Cmd+=` / `Cmd+-` / `Cmd+0` | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |

Right-clicking copies the selection if there is one, and pastes otherwise.

## Which shell gets launched

| Platform | Default |
| --- | --- |
| Windows | `powershell.exe` |
| macOS | `$SHELL` as a login shell (`-l`), so `/etc/paths` is applied |
| Linux | `$SHELL`, falling back to `/bin/bash` |

Override it with environment variables:

```sh
COMICTERM_SHELL=/usr/bin/fish npm start
COMICTERM_SHELL=/bin/bash COMICTERM_SHELL_ARGS="-l -i" npm start
```

## Development

```sh
npm run check   # syntax-check every source file
npm test        # unit tests for the shell/IPC logic (no install needed)
npm run smoke   # boot the app and drive a real shell end to end
```

`npm run smoke` needs a display. On a headless machine:

```sh
xvfb-run -a npm run smoke -- --no-sandbox
```

Set `COMICTERM_SMOKE_SCREENSHOT=/tmp/shot.png` to capture what the window
looked like at the end of the run.

### Layout

| Path | Process | Role |
| --- | --- | --- |
| `main.js` | main | Window lifecycle, PTY spawn/kill, IPC handlers |
| `preload.js` | preload | The only bridge the renderer gets (`ptyAPI`, `clipboardAPI`) |
| `renderer.js` | renderer | Tabs, xterm instances, keyboard shortcuts, settings |
| `index.html`, `style.css` | renderer | Markup and chrome styling |
| `src/shell.js` | main | Picks the shell and builds the child environment |
| `src/validate.js` | main | Validates IPC payloads before they reach node-pty |
| `test/` | — | Unit tests (`*.test.js`) and the end-to-end `smoke.js` |

`src/` holds the pure logic deliberately: it imports neither Electron nor
node-pty, so `npm test` runs it under plain Node with no build step.

### Security model

The renderer displays bytes from anywhere you point a shell at, so it is
treated as untrusted:

- `contextIsolation` and `sandbox` are on, `nodeIntegration` is off.
- A restrictive Content-Security-Policy blocks remote and inline scripts.
- Navigation is blocked and `window.open` is denied; `http(s)` links are handed
  to the system browser instead.
- Main validates every IPC payload, and a window can only reach the PTYs it
  owns.

## Licence

No licence has been chosen yet, so default copyright applies. Add a `LICENSE`
file if you want others to be able to use this.
