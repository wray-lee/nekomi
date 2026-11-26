import { existsSync, readFileSync, statSync } from 'node:fs';
import { NekomiEngine } from './engine';
import { SpriteRenderer, parseGfxFlag, probeGfxProtocol } from './gfx-protocol';
import { extractPrintableChar, parseTerminalInput, translateMouseForChild } from './input-parser';
import { isBodyHit, renderBand } from './tui-render';
import { BAND_ROWS } from './tui-sprite';
import type { AgyHookPayload, RenderSnapshot } from './types';

const PREFERRED_PORT = Number(process.env.NEKOMI_PORT ?? 47821);
const TARGET_CMD = process.env.NEKOMI_CMD ?? 'agy';
const RAW_ARGV = process.argv.slice(2);
const REQUESTED_GFX = parseGfxFlag(RAW_ARGV);
let mouseEnabled = RAW_ARGV.includes('--mouse') || process.env.NEKOMI_MOUSE === '1';
const TARGET_ARGS = RAW_ARGV.filter((arg) => !arg.startsWith('--gfx=') && arg !== '--mouse' && arg !== '--no-mouse');

const engine = new NekomiEngine();
let activeTranscriptPath = '';
let transcriptOffset = 0;
let activeConversationId = '';
let lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS ?? '';
let csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN ?? '';
let isPollingSubagents = false;

function syncTranscript(path?: string): void {
  if (!path || !existsSync(path)) return;
  try {
    if (path !== activeTranscriptPath) {
      activeTranscriptPath = path;
      transcriptOffset = 0;
    }
    const size = statSync(path).size;
    if (size <= transcriptOffset) return;
    const raw = readFileSync(path, 'utf8');
    const slice = raw.slice(transcriptOffset);
    transcriptOffset = raw.length;

    for (const line of slice.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const inTok = Number(entry.input_tokens ?? 0) + Number(entry.cache_read_tokens ?? 0);
      if (inTok > 0) engine.reportTokenCount(inTok);
    }
  } catch {
    // Ignore transient transcript write locks.
  }
}

async function pollSubagents(): Promise<void> {
  if (!activeConversationId || !lsAddress || !csrfToken || isPollingSubagents) return;
  isPollingSubagents = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600);
  try {
    const res = await fetch(`http://${lsAddress}/product.v1.ConversationService/ListConversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': csrfToken,
      },
      body: JSON.stringify({ parentConversationId: activeConversationId, pageSize: 20 }),
      signal: controller.signal,
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      conversations?: Array<{
        id?: string;
        annotations?: { title?: string };
        state?: { runState?: string; summary?: string };
      }>;
    };
    const running = (data.conversations ?? [])
      .filter((c) => c.id && c.state?.runState === 'RUN_STATE_RUNNING')
      .map((c) => ({
        id: c.id!,
        role: c.annotations?.title || c.state?.summary || 'subagent',
        depth: 1,
        isWorkflow: false,
      }));
    engine.syncSubagents(running);
  } catch {
    // Ignore transient LS API errors or timeouts.
  } finally {
    clearTimeout(timer);
    isPollingSubagents = false;
  }
}

function startHookServer() {
  const handler = async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, t: engine.scene.t });
    }
    if (req.method === 'POST' && url.pathname === '/hook') {
      try {
        const payload = (await req.json()) as AgyHookPayload;
        if (payload.conversationId) activeConversationId = payload.conversationId;
        if (payload._nekomi?.lsAddress) lsAddress = payload._nekomi.lsAddress;
        if (payload._nekomi?.csrfToken) csrfToken = payload._nekomi.csrfToken;
        engine.handleHook(payload);
        if (payload.transcriptPath) syncTranscript(payload.transcriptPath);
        if (
          payload.hookEventName === 'PostToolUse' &&
          (payload.toolCall?.name === 'invoke_subagent' || payload.toolCall?.name === 'manage_subagents')
        ) {
          void pollSubagents();
        }
        return Response.json({ ok: true, action: engine.currentAction() });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 400 });
      }
    }
    return new Response('Not Found', { status: 404 });
  };

  try {
    return Bun.serve({ hostname: '127.0.0.1', port: PREFERRED_PORT, fetch: handler });
  } catch {
    return Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  }
}

async function run(): Promise<void> {
  let pendingInput = '';
  const server = startHookServer();
  const resolvedGfx = await probeGfxProtocol(REQUESTED_GFX, process.env, 400, {
    onPendingInput: (text) => {
      pendingInput += text;
    },
  });
  const spriteRenderer = new SpriteRenderer(resolvedGfx);
  let cols = process.stdout.columns || 100;
  let rows = process.stdout.rows || 30;
  let agyRows = Math.max(6, rows - BAND_ROWS);

  let lastBandKey = '';
  let lastSnapshot: RenderSnapshot = engine.snapshot(cols);
  let repaintScheduled = false;
  let childMouseEnabled = false;

  const paintBand = (force = false) => {
    lastSnapshot = engine.snapshot(cols);
    const lines = renderBand(lastSnapshot, cols, { omitMainSprite: spriteRenderer.usesImageProtocol() });
    const key = `${spriteRenderer.overlayKey(lastSnapshot, cols)}\n${lines.join('\n')}`;
    if (!force && key === lastBandKey) return;
    lastBandKey = key;

    // Disable auto-wrap and reset DECSTBM while painting the bottom 6 rows so writes never
    // scroll the viewport and Sixel renders at the active cursor position (?80l).
    let out = `\x1b[?2026h\x1b7\x1b[?7l\x1b[r`;
    for (let i = 0; i < lines.length; i++) {
      out += `\x1b[${agyRows + 1 + i};1H\x1b[2K${lines[i]!.trimEnd()}`;
    }
    if (spriteRenderer.protocol === 'sixel') {
      out += '\x1b[?80l';
    }
    out += spriteRenderer.renderOverlay(lastSnapshot, cols, agyRows + 1);
    out += `\x1b[1;${agyRows}r\x1b[?7h\x1b8\x1b[?2026l`;
    process.stdout.write(out);
  };

  const scheduleRepaint = () => {
    if (repaintScheduled) return;
    repaintScheduled = true;
    setTimeout(() => {
      repaintScheduled = false;
      paintBand(true);
    }, 15);
  };

  // Reserve bottom BAND_ROWS via DECSTBM, enable SGR mouse tracking if enabled, and preload if needed.
  const mouseInit = mouseEnabled ? '\x1b[?1000h\x1b[?1006h' : '';
  process.stdout.write(`\x1b[2J\x1b[1;${agyRows}r\x1b[1;1H${mouseInit}${spriteRenderer.initSequence()}`);
  paintBand(true);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  const decoder = new TextDecoder();
  const term = new Bun.Terminal({
    cols,
    rows: agyRows,
    data(_terminal, data) {
      const text = decoder.decode(data);
      if (/\x1b\[\?(?:1000|1002|1003)h/.test(text)) childMouseEnabled = true;
      if (/\x1b\[\?(?:1000|1002|1003)l/.test(text)) childMouseEnabled = false;
      process.stdout.write(text);
      if (/\x1b\[[0-3]?J|\x1b\[\?1049[hl]|\x1b\[\d*(?:;\d*)?r/.test(text)) {
        scheduleRepaint();
      }
    },
  });

  const child = Bun.spawn([TARGET_CMD, ...TARGET_ARGS], {
    terminal: term,
    env: {
      ...process.env,
      NEKOMI_PORT: String(server.port),
    },
  });

  const onStdin = (buf: Buffer) => {
    const chunk = buf.toString('utf8');
    for (const tok of parseTerminalInput(chunk)) {
      if (tok.kind === 'mouse') {
        if (tok.row > agyRows) {
          // Click inside bottom 6-row nekomi pet band
          if (!tok.release && tok.btn === 0) {
            if (isBodyHit(lastSnapshot, tok.col, tok.row - agyRows) || lastSnapshot.isAsleep) {
              engine.poke();
              paintBand(true);
            }
          }
          continue;
        }
        const forwarded = translateMouseForChild(tok, childMouseEnabled);
        if (forwarded) term.write(forwarded);
      } else {
        // Alt+P / Ctrl+] pokes nekomi anytime without disabling native scroll wheel.
        if (tok.raw === '\x1bp' || tok.raw === '\x1bP' || tok.raw === '\x1d') {
          engine.poke();
          paintBand(true);
          continue;
        }
        // Alt+M toggles SGR mouse-click mode live without restarting agy.
        if (tok.raw === '\x1bm' || tok.raw === '\x1bM') {
          mouseEnabled = !mouseEnabled;
          process.stdout.write(mouseEnabled ? '\x1b[?1000h\x1b[?1006h' : '\x1b[?1000l\x1b[?1006l');
          engine.poke();
          paintBand(true);
          continue;
        }
        const ch = extractPrintableChar(tok.raw);
        if (ch) engine.typed(ch);
        term.write(tok.raw);
      }
    }
  };
  process.stdin.on('data', onStdin);
  if (pendingInput.length > 0) {
    onStdin(Buffer.from(pendingInput, 'utf8'));
  }

  const onResize = () => {
    cols = process.stdout.columns || 100;
    rows = process.stdout.rows || 30;
    agyRows = Math.max(6, rows - BAND_ROWS);
    term.resize(cols, agyRows);
    process.stdout.write(`\x1b[1;${agyRows}r`);
    paintBand(true);
  };
  process.stdout.on('resize', onResize);

  const timer = setInterval(() => {
    engine.tick(cols);
    paintBand(false);
  }, 100);

  const subagentTimer = setInterval(() => {
    void pollSubagents();
  }, 1500);

  const cleanup = () => {
    clearInterval(timer);
    clearInterval(subagentTimer);
    process.stdin.off('data', onStdin);
    process.stdout.off('resize', onResize);
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore raw mode restore errors.
      }
    }
    const mouseOff = mouseEnabled ? '\x1b[?1000l\x1b[?1006l' : '';
    process.stdout.write(`${spriteRenderer.clearSequence()}${mouseOff}\x1b[r\x1b[?25h\x1b[0m\n`);
    try {
      term.close();
    } catch {
      // Ignore already-closed terminal.
    }
    server.stop(true);
  };

  process.on('SIGINT', () => {
    try {
      child.kill();
    } catch {}
  });
  process.on('SIGTERM', () => {
    try {
      child.kill();
    } catch {}
  });

  const exitCode = await child.exited;
  cleanup();
  process.exit(exitCode);
}

run().catch((err) => {
  process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[r\x1b[?25h\x1b[0m\n');
  console.error('[nekomi] Fatal PTY wrapper error:', err);
  process.exit(1);
});
