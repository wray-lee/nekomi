import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { NekomiEngine } from '../src/engine';
import {
  SPRITE_IMG_COLS,
  SpriteRenderer,
  detectGfxProtocol,
  encodeKittyDeleteAll,
  encodeKittyDeletePlacement,
  encodeKittyPlace,
  encodeKittyUpload,
  encodeRgbaToSixel,
  parseGfxFlag,
  selectSpritePose,
} from '../src/gfx-protocol';
import { renderBand } from '../src/tui-render';

describe('Terminal image protocol & 48x48 integrated catgirl sprites', () => {
  test('parseGfxFlag prioritizes --gfx= over NEKOMI_GFX and defaults to auto', () => {
    expect(parseGfxFlag([], {})).toBe('auto');
    expect(parseGfxFlag([], { NEKOMI_GFX: 'sixel' })).toBe('sixel');
    expect(parseGfxFlag(['--gfx=kitty'], { NEKOMI_GFX: 'sixel' })).toBe('kitty');
    expect(parseGfxFlag(['--gfx=HALFBLOCK'], {})).toBe('halfblock');
  });

  test('detectGfxProtocol detects Kitty, Ghostty, WezTerm, WT Sixel, iTerm2, and SSH fallback', () => {
    expect(detectGfxProtocol({ KITTY_WINDOW_ID: '1' })).toBe('kitty');
    expect(detectGfxProtocol({ TERM: 'xterm-kitty' })).toBe('kitty');
    expect(detectGfxProtocol({ TERM_PROGRAM: 'ghostty' })).toBe('kitty');
    expect(detectGfxProtocol({ TERM_PROGRAM: 'WezTerm' })).toBe('kitty');
    expect(detectGfxProtocol({ WT_SESSION: 'abc-123' })).toBe('sixel');
    expect(detectGfxProtocol({ TERM_PROGRAM: 'iTerm.app' })).toBe('sixel');
    expect(detectGfxProtocol({ TERM: 'foot' })).toBe('sixel');
    expect(detectGfxProtocol({ TERM: 'xterm-256color' })).toBe('halfblock');
    expect(detectGfxProtocol({ KITTY_WINDOW_ID: '1' }, 'sixel')).toBe('sixel');
  });

  test('selectSpritePose maps all 18 integrated animation frames and facings accurately', () => {
    const eng = new NekomiEngine(20);
    expect(['idle_0', 'idle_1']).toContain(selectSpritePose(eng.snapshot(80)).pose);

    eng.handleHook({ hookEventName: 'PreInvocation' });
    const walkSnap = eng.snapshot(80);
    expect(['walk_0', 'walk_1']).toContain(selectSpritePose(walkSnap).pose);

    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 'e1', name: 'edit_file' } });
    expect(['code_0', 'code_1']).toContain(selectSpritePose(eng.snapshot(80)).pose);

    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 's1', name: 'run_command' } });
    expect(['term_0', 'term_1']).toContain(selectSpritePose(eng.snapshot(80)).pose);

    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 'r1', name: 'read_file' } });
    expect(['read_0', 'read_1']).toContain(selectSpritePose(eng.snapshot(80)).pose);

    eng.handleHook({ hookEventName: 'Stop', terminationReason: 'NO_TOOL_CALL' });
    expect(['happy_0', 'happy_1']).toContain(selectSpritePose(eng.snapshot(80)).pose);

    eng.handleHook({ hookEventName: 'Stop', terminationReason: 'ERROR' });
    expect(['oops_0', 'oops_1']).toContain(selectSpritePose(eng.snapshot(80)).pose);

    eng.scene.event = null;
    eng.typed('z');
    expect(['type_0', 'type_1']).toContain(selectSpritePose(eng.snapshot(80)).pose);

    eng.isWorking = false;
    eng.runningTools = [];
    eng.recent = null;
    eng.scene = { ...eng.scene, event: null, typing: null, idle: 6001, dir: -1 };
    const sleepSel = selectSpritePose(eng.snapshot(80));
    expect(['sleep_0', 'sleep_1']).toContain(sleepSel.pose);
    expect(sleepSel.facing).toBe('l');
  });

  test('Kitty Graphics Protocol encodes chunked uploads, quiet placements, and safe deletes', () => {
    const bigPng = new Uint8Array(4000).fill(0xab);
    const up = encodeKittyUpload(101, bigPng);
    expect(up).toContain('\x1b_Ga=t,f=100,i=101,q=2,m=1;');
    expect(up).toContain('\x1b_Gm=0;');

    const place = encodeKittyPlace(101, 25, 10, SPRITE_IMG_COLS, 6, 1);
    expect(place).toBe('\x1b[25;10H\x1b_Ga=p,i=101,p=1,c=12,r=6,C=1,z=-1,q=2\x1b\\');

    expect(encodeKittyDeletePlacement(101, 1)).toBe('\x1b_Ga=d,d=i,i=101,p=1,q=2\x1b\\');
    expect(encodeKittyDeleteAll()).toBe('\x1b_Ga=d,d=A,q=2\x1b\\');
  });

  test('encodeRgbaToSixel produces valid transparent P2=1 Sixel with RLE', () => {
    const w = 12;
    const h = 6;
    const rgba = new Uint8Array(w * h * 4);
    for (let x = 0; x < 8; x++) {
      const idx = x * 4;
      rgba[idx] = 110;
      rgba[idx + 1] = 168;
      rgba[idx + 2] = 255;
      rgba[idx + 3] = 255;
    }
    const sixel = encodeRgbaToSixel(rgba, w, h);
    expect(sixel.startsWith('\x1bP0;1;0q"1;1;12;6')).toBe(true);
    expect(sixel.endsWith('\x1b\\')).toBe(true);
    expect(sixel).toContain('!8@');
  });

  test('SpriteRenderer uses lazy Kitty upload and renderBand omits external Clawd ASCII FX in image mode', () => {
    const assetsDir = join(import.meta.dir, '..', 'assets', 'sprites');
    const eng = new NekomiEngine(30);
    eng.handleHook({ hookEventName: 'PostToolUse', toolCall: { id: 's1', name: 'run_command' } });
    eng.addHelper('k1', { role: 'Research', depth: 1, isWorkflow: false });
    eng.addHelper('k2', { role: 'Workflow', depth: 1, isWorkflow: true });
    const termSnap = eng.snapshot(80);

    const kitty = new SpriteRenderer('kitty', assetsDir, {});
    expect(kitty.protocol).toBe('kitty');
    expect(kitty.assetsLoaded).toBe(true);
    expect(kitty.usesImageProtocol()).toBe(true);
    expect(kitty.initSequence()).toBe('');

    const overlay1 = kitty.renderOverlay(termSnap, 80, 25);
    expect(overlay1).toContain('a=t,f=100,i=');
    expect(overlay1).toContain('p=10,');
    expect(overlay1).toContain('p=11,');
    expect(overlay1).toContain('p=1,');

    const overlay2 = kitty.renderOverlay(termSnap, 80, 25);
    expect(overlay2).not.toContain('a=t,f=100');
    expect(overlay2).toContain('a=d,d=i,i=');
    expect(overlay2).toContain('p=1,');
    expect(kitty.clearSequence()).toBe('\x1b_Ga=d,d=A,q=2\x1b\\');

    const sixel = new SpriteRenderer('sixel', assetsDir, {});
    expect(sixel.protocol).toBe('sixel');
    const sixelOut = sixel.renderOverlay(termSnap, 80, 25);
    expect(sixelOut).toContain('\x1bP0;1;0q"1;1;48;48');
    expect(sixelOut).toContain('\x1bP0;1;0q"1;1;96;96');

    // Clawd external holoTerm box & halfblock helper pixels are suppressed in image mode
    const lines = renderBand(termSnap, 80, { omitMainSprite: true });
    expect(lines.length).toBe(6);
    expect(lines.join('')).not.toContain('┌──┐');
    expect(lines.join('')).not.toContain('#9d4edd');

    // Typing echo bubble still renders cleanly beside the sprite
    eng.scene.event = null;
    eng.isWorking = false;
    eng.runningTools = [];
    eng.recent = null;
    eng.typed('k');
    const echoLines = renderBand(eng.snapshot(80), 80, { omitMainSprite: true });
    expect(echoLines.join('')).toContain('k');
  });
});
