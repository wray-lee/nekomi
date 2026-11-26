---
name: nekomi-setup
description: Configure, launch, or customize the nekomi terminal catgirl companion for Google Antigravity CLI (agy), including Kitty/Sixel protocol flags, SSH PTY launcher, and optional shell aliases using Bun.
---

# nekomi Companion Setup

Use this skill when the user asks how to launch, troubleshoot, or customize **nekomi** inside their terminal or SSH session.

## Runtime Requirement

- **Always use Bun (`bun` / `bunx`)**, never Node or npm.

## Launching nekomi

1. **Full `agy` companion mode (recommended for local & SSH without `tmux`)**:
   - Windows: `<plugin-dir>/nekomi.cmd`
   - Linux / macOS / SSH: `<plugin-dir>/nekomi`
   - Or directly with Bun: `bun run "<plugin-dir>/src/pty-wrapper.ts"`
2. **Standalone `tmux` pane / interactive demo**:
   - Demo showcase: `bun run "<plugin-dir>/src/tui-standalone.ts" --demo`
   - Hook listener pane: `bun run "<plugin-dir>/src/tui-standalone.ts"`

## Graphics Protocol Selection

- Default is `--gfx=auto` (or `NEKOMI_GFX=auto`):
  - **Kitty Graphics Protocol** (`kitty`): Ghostty, WezTerm, Kitty, Konsole
  - **Sixel** (`sixel`): Windows Terminal (1.22+), iTerm2, mintty, foot, mlterm
  - **24-bit Half-block** (`halfblock`): automatic fallback for plain text terminals
- Override via `--gfx=kitty|sixel|halfblock` or `NEKOMI_GFX`.
- **Native Scroll Wheel vs. Click-to-Poke**: PTY wrapper mode keeps native terminal mouse scrolling and text selection active by default. Pass `--mouse` (or set `NEKOMI_MOUSE=1`) to enable SGR click-to-poke on nekomi in the bottom band.

## Optional Auto-Launch Shell Function

Because lifecycle hooks run inside child pipes and cannot resize `agy`'s active PTY, users who want typing `agy` directly to launch with **nekomi** can wrap `agy` in their shell profile pointing `NEKOMI_CMD` to the real `agy` binary path:

- **PowerShell (`$PROFILE`)**:
  ```powershell
  function agy {
    $env:NEKOMI_CMD = (Get-Command agy.exe -CommandType Application | Select-Object -First 1 -ExpandProperty Source)
    bun run "$HOME/.gemini/config/plugins/nekomi/src/pty-wrapper.ts" @args
  }
  ```
- **Bash / Zsh (`~/.bashrc` or `~/.zshrc`)**:
  ```sh
  agy() {
    NEKOMI_CMD="$(command -v agy)" bun run "$HOME/.gemini/config/plugins/nekomi/src/pty-wrapper.ts" "$@"
  }
  ```
