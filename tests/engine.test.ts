import { describe, expect, test } from 'bun:test';
import { actions, fidgetAt } from '../src/actions';
import { NekomiEngine, HOLD_TICKS, SLEEP_AFTER, TYPING_TICKS, activityOfAgyTool, lineUpHelpers } from '../src/engine';
import { extractPrintableChar, parseTerminalInput } from '../src/input-parser';
import { HELPER_PALETTE, pickHelperColor } from '../src/palette';
import { isBodyHit, renderBand } from '../src/tui-render';
import { BAND_ROWS, PIXEL_H, PIXEL_W, buildHelperPixelGrid, buildTuiPixelGrid } from '../src/tui-sprite';

describe('NekomiEngine & TUI full mechanics', () => {
  test('maps agy tools to all activity kinds', () => {
    expect(activityOfAgyTool('run_command')).toBe('shell');
    expect(activityOfAgyTool('manage_task')).toBe('shell');
    expect(activityOfAgyTool('read_file')).toBe('read');
    expect(activityOfAgyTool('search_web')).toBe('search');
    expect(activityOfAgyTool('edit_file')).toBe('edit');
    expect(activityOfAgyTool('write_file')).toBe('edit');
    expect(activityOfAgyTool('run_workflow')).toBe('skill');
    expect(activityOfAgyTool('call_mcp_tool')).toBe('mcp');
    expect(activityOfAgyTool('update_steps')).toBe('todo');
    expect(activityOfAgyTool('browser_navigate')).toBe('fetch');
  });

  test('SessionStart -> hello, PreInvocation -> walk, PostToolUse -> hold -> Stop celebrate', () => {
    const eng = new NekomiEngine(40);
    eng.handleHook({ hookEventName: 'SessionStart' });
    expect(eng.currentAction()).toBe('hello');

    for (let i = 0; i < 20; i++) eng.tick(100);
    expect(eng.currentAction()).toBe('idle');

    eng.handleHook({ hookEventName: 'PreInvocation', invocationNum: 1 });
    expect(eng.currentAction()).toBe('walk');

    const startX = eng.scene.x;
    for (let i = 0; i < 6; i++) eng.tick(100);
    expect(eng.scene.x).not.toBe(startX);

    // PostToolUse alone triggers the tool animation for HOLD_TICKS
    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 't1', name: 'edit_file' } });
    expect(eng.currentAction()).toBe('edit');

    for (let i = 0; i < HOLD_TICKS + 1; i++) eng.tick(100);
    expect(eng.currentAction()).toBe('walk');

    eng.handleHook({ hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL' });
    expect(eng.currentAction()).toBe('celebrate');
  });

  test('typing echo wakes sleeping character and shows last typed character', () => {
    const eng = new NekomiEngine();
    for (let i = 0; i < SLEEP_AFTER; i++) eng.tick(80);
    expect(eng.currentAction()).toBe('sleep');

    eng.typed('a');
    expect(eng.currentAction()).toBe('wake');
    for (let i = 0; i < 10; i++) eng.tick(80);
    expect(eng.currentAction()).toBe('echo');
    const snap = eng.snapshot(80);
    expect(snap.pose.fx.some((f) => f.kind === 'bubble' && f.text === 'a')).toBe(true);

    for (let i = 0; i < TYPING_TICKS; i++) eng.tick(80);
    expect(eng.currentAction()).toBe('idle');
  });

  test('error triggers oops; USER_CANCELED -> shrug; ERROR -> sad', () => {
    const eng = new NekomiEngine();
    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 't1', name: 'run_command' }, error: 'exit status 1' });
    expect(eng.currentAction()).toBe('oops');

    eng.handleHook({ hookEventName: 'Stop', terminationReason: 'USER_CANCELED' });
    expect(eng.currentAction()).toBe('shrug');

    eng.handleHook({ hookEventName: 'Stop', terminationReason: 'ERROR' });
    expect(eng.currentAction()).toBe('sad');
  });

  test('all 14 idle fidgets never repeat consecutively and render clean poses', () => {
    let prev = -1;
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const f = fidgetAt(i);
      expect(f).not.toBe(prev);
      prev = f;
      seen.add(f);
    }
    expect(seen.size).toBe(14);
    expect(actions.idle({ t: 75, x: 30, width: 80, dir: -1, blink: false, typed: null })).toBeDefined();
  });

  test('poke maps every active state to its distinct click reaction', () => {
    const eng = new NekomiEngine();
    expect(eng.poke()).toBe('pet');
    expect(eng.poke()).toBeNull();

    eng.scene.event = null;
    eng.handleHook({ hookEventName: 'PreInvocation' });
    expect(eng.poke()).toBe('spin');

    eng.scene.event = null;
    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 'e1', name: 'edit_file' } });
    expect(eng.poke()).toBe('bonk');

    eng.scene.event = null;
    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 'm1', name: 'call_mcp_tool' } });
    expect(eng.poke()).toBe('zap');
  });

  test('helper lineup nests children after parent and uses unique 12-color palette', () => {
    const used: string[] = [];
    for (let i = 0; i < HELPER_PALETTE.length; i++) {
      const c = pickHelperColor(used);
      expect(used).not.toContain(c);
      used.push(c);
    }
    const lined = lineUpHelpers([
      { id: 'a', depth: 1, color: '#ff5f87' },
      { id: 'b', depth: 1, color: '#ffd75f' },
      { id: 'a1', parent: 'a', depth: 2, color: '#87d75f' },
    ]);
    expect(lined.map((h) => h.id)).toEqual(['a', 'a1', 'b']);
  });

  test('TUI half-block sprite dimensions, band rendering, and SGR mouse parsing', () => {
    const eng = new NekomiEngine(30);
    eng.addHelper('h1', { role: 'wf', depth: 1, isWorkflow: true });
    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 'e1', name: 'edit_file' } });
    const snap = eng.snapshot(80);
    const grid = buildTuiPixelGrid(snap.pose);
    expect(grid.length).toBe(PIXEL_H);
    expect(grid[0]!.length).toBe(PIXEL_W);
    expect(buildHelperPixelGrid('#5fd7ff', 1, true, false)[0]!.length).toBe(8);

    const lines = renderBand(snap, 80);
    expect(lines.length).toBe(BAND_ROWS);
    expect(isBodyHit(snap, snap.x + 4, 3)).toBe(true);
    expect(isBodyHit(snap, 1, 3)).toBe(false);

    const tokens = parseTerminalInput('hi\x1b[<0;35;28M\x1b[<0;35;28m');
    expect(tokens.length).toBe(3);
    expect(tokens[0]).toEqual({ kind: 'data', raw: 'hi' });
    expect(tokens[1]).toEqual({ kind: 'mouse', raw: '\x1b[<0;35;28M', btn: 0, col: 35, row: 28, release: false });
    expect(tokens[2]).toEqual({ kind: 'mouse', raw: '\x1b[<0;35;28m', btn: 0, col: 35, row: 28, release: true });
    expect(extractPrintableChar('abc')).toBe('c');
    expect(extractPrintableChar('\x1b[A')).toBeNull();
  });

  test('helpers never spawn for normal tools and clear cleanly on Stop or syncSubagents([])', () => {
    const eng = new NekomiEngine();
    for (const tool of ['read_file', 'run_command', 'edit_file', 'run_workflow']) {
      eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: `id_${tool}`, name: tool } });
    }
    expect(eng.helpers.size).toBe(0);

    eng.handleHook({
      hookEventName: 'PostToolUse',
      toolCall: { id: 'sub1', name: 'invoke_subagent', args: { Role: 'Reviewer' } },
    });
    expect(eng.helpers.size).toBe(1);

    // Stop with fullyIdle: false keeps running background helpers
    eng.handleHook({ hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL', fullyIdle: false });
    expect(eng.helpers.size).toBe(1);

    // Stop when fullyIdle is omitted or true clears helpers
    eng.handleHook({ hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL' });
    expect(eng.helpers.size).toBe(0);

    // syncSubagents([]) removes all helpers including wf:* entries
    eng.addHelper('wf:job:0', { role: 'wf', depth: 1, isWorkflow: true });
    eng.addHelper('sub:conv1', { role: 'agent', depth: 1, isWorkflow: false });
    expect(eng.helpers.size).toBe(2);
    eng.syncSubagents([]);
    expect(eng.helpers.size).toBe(0);
  });

  test('helpers consistently trail behind nekomi facing direction across screen halves', () => {
    const eng = new NekomiEngine(20);
    eng.addHelper('h1', { role: 'sub', depth: 1, isWorkflow: false });

    // Facing right on the left half -> kitten trails behind on the left (x < snap.x)
    eng.scene = { ...eng.scene, x: 20, dir: 1 };
    let snap = eng.snapshot(100);
    expect(snap.pose.facing).toBe(1);
    expect(snap.helpers[0]!.x).toBeLessThan(snap.x);

    // Facing right on the right half -> still trails behind on the left (x < snap.x)
    eng.scene = { ...eng.scene, x: 70, dir: 1 };
    snap = eng.snapshot(100);
    expect(snap.helpers[0]!.x).toBeLessThan(snap.x);

    // Facing left on the right half -> kitten trails behind on the right (x > snap.x)
    eng.scene = { ...eng.scene, x: 70, dir: -1 };
    snap = eng.snapshot(100);
    expect(snap.pose.facing).toBe(-1);
    expect(snap.helpers[0]!.x).toBeGreaterThan(snap.x);

    // Facing left on the left half -> still trails behind on the right (x > snap.x)
    eng.scene = { ...eng.scene, x: 20, dir: -1 };
    snap = eng.snapshot(100);
    expect(snap.helpers[0]!.x).toBeGreaterThan(snap.x);
  });
});
