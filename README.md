# ComicTerm

A tabbed terminal emulator for Windows. Electron + xterm.js + node-pty, defaults to Cascadia Mono (Windows Terminal's font) — change it to whatever you want in the box top-right.

## Run

```
npm install
npx electron .
```

Tabs run PowerShell on Windows and your login shell (`$SHELL`) elsewhere; set
`COMICTERM_SHELL` to use something else.

## Features

- Tabs, each running its own shell, labelled with the title the shell sets
- 256-colour and truecolor output (`TERM=xterm-256color`, `COLORTERM=truecolor`)
- Copy and paste in the Windows Terminal style — including right-click, which
  copies the selection or pastes when nothing is selected
- Ctrl+click a URL to open it in your browser
- Font and font size are live-editable and remembered between runs
- A shell that exits cleanly closes its tab; one that fails (or can't start)
  leaves the tab open showing why

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New tab | `Ctrl+Shift+T` |
| Close tab | `Ctrl+Shift+W`, or middle-click the tab |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` (or `Ctrl+PgDn` / `Ctrl+PgUp`) |
| Copy | `Ctrl+Shift+C`, or `Ctrl+C` while text is selected |
| Paste | `Ctrl+Shift+V`, or right-click |
| Font size | `Ctrl+=` / `Ctrl+-`, `Ctrl+0` to reset |

`Ctrl+C` with nothing selected is the usual interrupt.

## Test

```
npm test            # on Linux without a display: xvfb-run -a npm test
```

Launches the real app over real shells and drives it — typing, tabs,
clipboard, fonts, reloads, exits. CI runs it on Windows and Linux.
