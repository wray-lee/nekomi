import { existsSync, readFileSync, statSync } from 'node:fs';
import { NekomiEngine } from './engine';
import { SpriteRenderer, parseGfxFlag } from './gfx-protocol';
import { extractPrintableChar, parseTerminalInput } from './input-parser';
import { isBodyHit, renderBand } from './tui-render';
import { BAND_ROWS } from './tui-sprite';
import type { AgyHookPayload, EventKind, RenderSnapshot } from './types';

const PREFERRED_PORT = Number(process.env.NEKOMI_PORT ?? 47821);
const TARGET_CMD = process.env.NEKOMI_CMD ?? 'agy';
const RAW_ARGV = process.argv.slice(2);
const REQUESTED_GFX = parseGfxFlag(RAW_ARGV);
const TARGET_ARGS = RAW_ARGV.filter((arg) => !arg.startsWith('--gfx='));

const engine = new NekomiEngine();
let demoQueue: Array<{ kind: 'event' | 'activity'; value: string; until: number }> = [];
let activeTranscriptPath = '';
let transcriptOffset = 0;
const KNOWN_SUBAGENTS = new Map<string, { id: string; role: string; depth: number; isWorkflow: boolean }>();

function syncTranscript(path?: string): void {
  if (!path || !existsSync(path)) return;
  try {
    if (path !== activeTranscriptPath) {
      activeTranscriptPath = path;
      transcriptOffset = 0;
      KNOWN_SUBAGENTS.clear();
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
      const calls = Array.isArray(entry.tool_calls) ? entry.tool_calls : [];
      for (const tc of calls) {
        if (!tc || typeof tc !== 'object') continue;
        const call = tc as { name?: string; args?: Record<string, unknown> };
        if (call.name === 'invoke_subagent') {
          const role = String(call.args?.Role ?? call.args?.TypeName ?? 'subagent');
          const id = `sub:${role}:${KNOWN_SUBAGENTS.size}`;
          KNOWN_SUBAGENTS.set(id, { id, role, depth: 1, isWorkflow: false });
        } else if (call.name === 'manage_subagents' && call.args?.Action === 'kill_all') {
          KNOWN_SUBAGENTS.clear();
        }
      }
    }
    if (KNOWN_SUBAGENTS.size > 0) {
      engine.syncSubagents([...KNOWN_SUBAGENTS.values()]);
    }
  } catch {
    // Ignore transient transcript write locks.
  }
}

function applyDemoItem(item: { kind: 'event' | 'activity'; value: string }): void {
  if (item.kind === 'event') {
    engine.triggerEvent(item.value as EventKind);
  } else {
    engine.isWorking = true;
    engine.runningTools = [{ id: 'demo', name: item.value, activity: item.value as never, startedAt: Date.now() }];
    engine.recent = { activity: item.value as never, until: engine.scene.t + 18 };
  }
}

function startDemoShowcase(): void {
  const seq: Array<{ kind: 'event' | 'activity'; value: string; ticks: number }> = [
    { kind: 'event', value: 'hello', ticks: 16 },
    { kind: 'activity', value: 'think', ticks: 22 },
    { kind: 'activity', value: 'shell', ticks: 18 },
    { kind: 'activity', value: 'read', ticks: 18 },
    { kind: 'activity', value: 'search', ticks: 18 },
    { kind: 'activity', value: 'edit', ticks: 20 },
    { kind: 'activity', value: 'skill', ticks: 20 },
    { kind: 'activity', value: 'mcp', ticks: 18 },
    { kind: 'activity', value: 'plan', ticks: 20 },
    { kind: 'activity', value: 'todo', ticks: 18 },
    { kind: 'activity', value: 'fetch', ticks: 18 },
    { kind: 'activity', value: 'compact', ticks: 16 },
    { kind: 'event', value: 'oops', ticks: 12 },
    { kind: 'event', value: 'celebrate', ticks: 22 },
  ];
  engine.helpers.clear();
  engine.addHelper('demo-1', { role: 'Research', depth: 1, isWorkflow: false });
  engine.addHelper('demo-2', { role: 'Workflow', depth: 1, isWorkflow: true });
  engine.addHelper('demo-3', { role: 'Sub-2', parent: 'demo-1', depth: 2, isWorkflow: false });

  let cursor = engine.scene.t;
  demoQueue = seq.map((s) => {
    cursor += s.ticks;
    return { kind: s.kind, value: s.value, until: cursor };
  });
  if (demoQueue[0]) applyDemoItem(demoQueue[0]);
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
        demoQueue = [];
        engine.handleHook(payload);
        if (payload.transcriptPath) syncTranscript(payload.transcriptPath);
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
  const server = startHookServer();
  const spriteRenderer = new SpriteRenderer(REQUESTED_GFX);
  let cols = process.stdout.columns || 100;
  let rows = process.stdout.rows || 30;
  let agyRows = Math.max(6, rows - BAND_ROWS);

  let lastBandKey = '';
  let lastSnapshot: RenderSnapshot = engine.snapshot(cols);
  let repaintScheduled = false;

  const paintBand = (force = false) => {
    lastSnapshot = engine.snapshot(cols);
    const lines = renderBand(lastSnapshot, cols, { omitMainSprite: spriteRenderer.usesImageProtocol() });
    const key = `${spriteRenderer.overlayKey(lastSnapshot, cols)}\n${lines.join('\n')}`;
    if (!force && key === lastBandKey) return;
    lastBandKey = key;

    let out = `\x1b[?2026h\x1b7\x1b[1;${agyRows}r`;
    for (let i = 0; i < lines.length; i++) {
      out += `\x1b[${agyRows + 1 + i};1H\x1b[2K${lines[i]}`;
    }
    out += spriteRenderer.renderOverlay(lastSnapshot, cols, agyRows + 1);
    out += '\x1b8\x1b[?2026l';
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

  // Reserve bottom BAND_ROWS via DECSTBM, enable SGR mouse tracking, and preload Kitty images if enabled.
  process.stdout.write(`\x1b[2J\x1b[1;${agyRows}r\x1b[1;1H\x1b[?1000h\x1b[?1006h${spriteRenderer.initSequence()}`);
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
      process.stdout.write(text);
      if (/\x1b\[2J|\x1b\[\?1049[hl]|\x1b\[r/.test(text)) {
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
          // Click inside bottom 6-row Gemini pet band
          if (!tok.release && tok.btn === 0) {
            if (isBodyHit(lastSnapshot, tok.col, tok.row - agyRows) || lastSnapshot.isAsleep) {
              engine.poke();
              paintBand(true);
            }
          } else if (!tok.release && tok.btn === 2) {
            startDemoShowcase();
            paintBand(true);
          }
          continue;
        }
        term.write(tok.raw);
      } else {
        const ch = extractPrintableChar(tok.raw);
        if (ch) engine.typed(ch);
        term.write(tok.raw);
      }
    }
  };
  process.stdin.on('data', onStdin);

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
    if (demoQueue.length > 0) {
      const cur = demoQueue[0]!;
      if (engine.scene.t >= cur.until) {
        demoQueue.shift();
        engine.runningTools = [];
        engine.isWorking = false;
        engine.recent = null;
        if (demoQueue.length > 0) applyDemoItem(demoQueue[0]!);
        else engine.helpers.clear();
      }
    }
    engine.tick(cols);
    paintBand(false);
  }, 100);

  const cleanup = () => {
    clearInterval(timer);
    process.stdin.off('data', onStdin);
    process.stdout.off('resize', onResize);
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore raw mode restore errors.
      }
    }
    process.stdout.write(`${spriteRenderer.clearSequence()}\x1b[?1000l\x1b[?1006l\x1b[r\x1b[?25h\x1b[0m\n`);
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
