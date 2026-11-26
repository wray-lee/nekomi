import { NekomiEngine } from './engine';
import { type GfxProtocol, SpriteRenderer, parseGfxFlag } from './gfx-protocol';
import { parseTerminalInput } from './input-parser';
import { isBodyHit, renderBand } from './tui-render';
import { BAND_ROWS } from './tui-sprite';
import type { AgyHookPayload, EventKind, RenderSnapshot } from './types';

const PORT = Number(process.env.NEKOMI_PORT ?? 47821);
const DEMO_MODE = process.argv.includes('--demo');
const GFX_CYCLE: GfxProtocol[] = ['kitty', 'sixel', 'halfblock'];
let spriteRenderer = new SpriteRenderer(parseGfxFlag(process.argv.slice(2)));

const engine = new NekomiEngine();
let demoQueue: Array<{ kind: 'event' | 'activity'; value: string; until: number }> = [];
let showHelpers = false;

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

let server: ReturnType<typeof Bun.serve> | null = null;
try {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/health') {
        return Response.json({ ok: true, t: engine.scene.t });
      }
      if (req.method === 'POST' && url.pathname === '/hook') {
        const payload = (await req.json()) as AgyHookPayload;
        demoQueue = [];
        engine.handleHook(payload);
        return Response.json({ ok: true, action: engine.currentAction() });
      }
      return new Response('Not Found', { status: 404 });
    },
  });
} catch {
  // Run without binding port if another instance already holds it.
}

let cols = process.stdout.columns || 80;
let lastKey = '';
let lastSnapshot: RenderSnapshot = engine.snapshot(cols);

const draw = (force = false) => {
  lastSnapshot = engine.snapshot(cols);
  const lines = renderBand(lastSnapshot, cols, { omitMainSprite: spriteRenderer.usesImageProtocol() });
  const key = `${lastSnapshot.action}:${spriteRenderer.overlayKey(lastSnapshot, cols)}:${lines.join('\n')}`;
  if (!force && key === lastKey) return;
  lastKey = key;

  const status = ` [nekomi] action=${lastSnapshot.action} gfx=${spriteRenderer.protocol}  (click=poke | d=demo | h=helpers | g=gfx | s=sleep | q=quit)`;
  let out = '\x1b[?2026h\x1b[1;1H';
  for (let i = 0; i < BAND_ROWS; i++) {
    out += `\x1b[${i + 1};1H\x1b[2K${lines[i]}`;
  }
  out += spriteRenderer.renderOverlay(lastSnapshot, cols, 1);
  out += `\x1b[${BAND_ROWS + 1};1H\x1b[2K\x1b[2m${status.slice(0, cols)}\x1b[0m\x1b[?2026l`;
  process.stdout.write(out);
};

process.stdout.write(`\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[2J${spriteRenderer.initSequence()}`);
if (DEMO_MODE) startDemoShowcase();
draw(true);

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

const cleanup = () => {
  clearInterval(timer);
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {}
  }
  process.stdout.write(`${spriteRenderer.clearSequence()}\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l\x1b[0m`);
  server?.stop(true);
  process.exit(0);
};

process.stdin.on('data', (buf: Buffer) => {
  const chunk = buf.toString('utf8');
  for (const tok of parseTerminalInput(chunk)) {
    if (tok.kind === 'mouse') {
      if (!tok.release && tok.btn === 0) {
        if (isBodyHit(lastSnapshot, tok.col, tok.row) || lastSnapshot.isAsleep) {
          engine.poke();
          draw(true);
        }
      }
    } else {
      if (tok.raw === 'q' || tok.raw === '\x03') cleanup();
      if (tok.raw === 'd') {
        startDemoShowcase();
        draw(true);
      }
      if (tok.raw === 'h') {
        showHelpers = !showHelpers;
        if (showHelpers) {
          engine.addHelper('h1', { role: 'Research', depth: 1, isWorkflow: false });
          engine.addHelper('h2', { role: 'Workflow', depth: 1, isWorkflow: true });
          engine.addHelper('h3', { role: 'Sub-2', parent: 'h1', depth: 2, isWorkflow: false });
        } else {
          engine.helpers.clear();
        }
        draw(true);
      }
      if (tok.raw === 'g') {
        const curIdx = GFX_CYCLE.indexOf(spriteRenderer.protocol);
        const nextProto = GFX_CYCLE[(curIdx + 1) % GFX_CYCLE.length]!;
        process.stdout.write(spriteRenderer.clearSequence());
        spriteRenderer = new SpriteRenderer(nextProto);
        process.stdout.write(spriteRenderer.initSequence());
        draw(true);
      }
      if (tok.raw === 's') {
        engine.isWorking = false;
        engine.runningTools = [];
        engine.recent = null;
        engine.scene = { ...engine.scene, event: null, idle: 6001 };
        draw(true);
      }
    }
  }
});

process.stdout.on('resize', () => {
  cols = process.stdout.columns || 80;
  draw(true);
});

const timer = setInterval(() => {
  if (demoQueue.length > 0) {
    const cur = demoQueue[0]!;
    if (engine.scene.t >= cur.until) {
      demoQueue.shift();
      engine.runningTools = [];
      engine.isWorking = false;
      engine.recent = null;
      if (demoQueue.length > 0) applyDemoItem(demoQueue[0]!);
      else if (DEMO_MODE) startDemoShowcase();
      else engine.helpers.clear();
    }
  }
  engine.tick(cols);
  draw(false);
}, 100);

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
