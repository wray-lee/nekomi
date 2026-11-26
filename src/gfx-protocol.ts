import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPRITE_W } from './engine';
import { BAND_ROWS } from './tui-sprite';
import type { RenderHelper, RenderSnapshot } from './types';

export type GfxProtocol = 'kitty' | 'sixel' | 'halfblock';
export type SpritePoseKey =
  | 'idle_0'
  | 'idle_1'
  | 'walk_0'
  | 'walk_1'
  | 'code_0'
  | 'code_1'
  | 'term_0'
  | 'term_1'
  | 'read_0'
  | 'read_1'
  | 'happy_0'
  | 'happy_1'
  | 'sleep_0'
  | 'sleep_1'
  | 'oops_0'
  | 'oops_1'
  | 'type_0'
  | 'type_1';

/** Terminal cell columns occupied by high-res image sprite (centered in SPRITE_W=16). */
export const SPRITE_IMG_COLS = 12;
export const SPRITE_IMG_COL_OFFSET = Math.floor((SPRITE_W - SPRITE_IMG_COLS) / 2);

const ALL_POSES: SpritePoseKey[] = [
  'idle_0',
  'idle_1',
  'walk_0',
  'walk_1',
  'code_0',
  'code_1',
  'term_0',
  'term_1',
  'read_0',
  'read_1',
  'happy_0',
  'happy_1',
  'sleep_0',
  'sleep_1',
  'oops_0',
  'oops_1',
  'type_0',
  'type_1',
];

interface KittenManifestEntry {
  color: string;
  plainOpenPng: string;
  plainOpenSixel: string;
  plainBlinkPng: string;
  plainBlinkSixel: string;
  wfOpenPng: string;
  wfOpenSixel: string;
  wfBlinkPng: string;
  wfBlinkSixel: string;
}

interface SpriteManifest {
  version: number;
  pngSize: number;
  sixelSize: number;
  poses: Array<{
    pose: SpritePoseKey;
    rightPng: string;
    leftPng: string;
    rightSixel: string;
    leftSixel: string;
  }>;
  kittens?: KittenManifestEntry[];
}

interface LoadedAsset {
  kittyId: number;
  pngBytes: Uint8Array;
  sixel: string;
}

interface KittenVariantAssets {
  plainOpen: LoadedAsset;
  plainBlink: LoadedAsset;
  wfOpen: LoadedAsset;
  wfBlink: LoadedAsset;
}

/** Parse `--gfx=` CLI flag, falling back to `NEKOMI_GFX`, then `'auto'`. */
export function parseGfxFlag(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): 'auto' | GfxProtocol {
  for (const arg of argv) {
    if (arg.startsWith('--gfx=')) {
      const val = arg.slice(6).trim().toLowerCase();
      if (val === 'auto' || val === 'kitty' || val === 'sixel' || val === 'halfblock') {
        return val;
      }
    }
  }
  const envVal = env.NEKOMI_GFX?.trim().toLowerCase();
  if (envVal === 'auto' || envVal === 'kitty' || envVal === 'sixel' || envVal === 'halfblock') {
    return envVal;
  }
  return 'auto';
}

/** Auto-detect terminal image protocol support from environment variables. */
export function detectGfxProtocol(
  env: Record<string, string | undefined> = process.env,
  requested: 'auto' | GfxProtocol = 'auto'
): GfxProtocol {
  if (requested !== 'auto') return requested;

  const term = (env.TERM ?? '').toLowerCase();
  const termProg = env.TERM_PROGRAM ?? '';
  const termProgLower = termProg.toLowerCase();

  if (
    env.KITTY_WINDOW_ID ||
    term === 'xterm-kitty' ||
    termProgLower === 'ghostty' ||
    env.GHOSTTY_RESOURCES_DIR ||
    termProg === 'WezTerm' ||
    termProgLower === 'wezterm' ||
    env.WEZTERM_PANE ||
    termProgLower === 'konsole'
  ) {
    return 'kitty';
  }

  if (
    env.WT_SESSION ||
    termProg === 'iTerm.app' ||
    termProgLower === 'mintty' ||
    /^(foot|mlterm|yaft)/.test(term)
  ) {
    return 'sixel';
  }

  return 'halfblock';
}

/** Kitty Graphics Query + VT DA1 query sent together so DA1 terminates the probe. */
export const TERMINAL_GFX_QUERY = '\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c';

const KITTY_PROBE_RE = /\x1b_Gi=31;[^\x1b\x07]*(?:\x1b\\|\x07)/g;
const DA1_PROBE_RE = /\x1b\[\?([0-9;]*)c/g;

export interface ProbeStreams {
  stdin: {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
    resume: () => void;
    on: (event: 'data', listener: (chunk: Buffer | string) => void) => void;
    off: (event: 'data', listener: (chunk: Buffer | string) => void) => void;
  };
  stdout: {
    isTTY?: boolean;
    write: (data: string) => unknown;
  };
}

export interface ProbeGfxOptions {
  streams?: ProbeStreams;
  onPendingInput?: (text: string) => void;
}

/** Parse a combined Kitty graphics query + VT DA1 terminal probe response. */
export function parseTerminalGfxProbe(reply: string): { done: boolean; protocol: GfxProtocol | null } {
  const hasKitty = /\x1b_Gi=31;OK(?:\x1b\\|\x07)/.test(reply);
  const da1 = reply.match(/\x1b\[\?([0-9;]*)c/);
  if (da1) {
    const params = da1[1]!.split(';').filter(Boolean);
    return { done: true, protocol: hasKitty ? 'kitty' : params.includes('4') ? 'sixel' : 'halfblock' };
  }
  return { done: false, protocol: hasKitty ? 'kitty' : null };
}

/** Remove Kitty query and DA1 probe responses so concurrent user keystrokes are preserved. */
export function stripTerminalGfxProbe(reply: string): string {
  return reply.replace(KITTY_PROBE_RE, '').replace(DA1_PROBE_RE, '');
}

/**
 * Actively query Kitty graphics + VT DA1 over TTY when env vars do not identify the terminal
 * (e.g., over SSH where WT_SESSION / KITTY_WINDOW_ID / TERM_PROGRAM are not forwarded).
 */
export async function probeGfxProtocol(
  requested: 'auto' | GfxProtocol = 'auto',
  env: Record<string, string | undefined> = process.env,
  timeoutMs = 400,
  options: ProbeGfxOptions = {}
): Promise<GfxProtocol> {
  const envDetected = detectGfxProtocol(env, requested);
  if (requested !== 'auto' || envDetected !== 'halfblock') return envDetected;

  const streams = options.streams ?? { stdin: process.stdin, stdout: process.stdout };
  if (!streams.stdin.isTTY || !streams.stdout.isTTY || (env.TERM ?? '').toLowerCase() === 'dumb') {
    return 'halfblock';
  }

  const wasRaw = Boolean(streams.stdin.isRaw);
  return await new Promise<GfxProtocol>((resolve) => {
    let buffer = '';
    let settled = false;

    const finish = (proto: GfxProtocol) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      streams.stdin.off('data', onData);
      if (!wasRaw) {
        try {
          streams.stdin.setRawMode?.(false);
        } catch {
          // Ignore raw mode restore errors.
        }
      }
      const remainder = stripTerminalGfxProbe(buffer);
      if (remainder) {
        options.onPendingInput?.(remainder);
      }
      resolve(proto);
    };

    const onData = (buf: Buffer | string) => {
      buffer += typeof buf === 'string' ? buf : buf.toString('utf8');
      const parsed = parseTerminalGfxProbe(buffer);
      if (parsed.done) {
        finish(parsed.protocol ?? 'halfblock');
      }
    };

    const timer = setTimeout(() => {
      const parsed = parseTerminalGfxProbe(buffer);
      finish(parsed.protocol ?? 'halfblock');
    }, timeoutMs);

    try {
      if (!wasRaw) streams.stdin.setRawMode?.(true);
      streams.stdin.resume();
      streams.stdin.on('data', onData);
      streams.stdout.write(TERMINAL_GFX_QUERY);
    } catch {
      finish('halfblock');
    }
  });
}

/** Map current engine snapshot to one of the 18 animated catgirl frames + facing direction. */
export function selectSpritePose(snapshot: RenderSnapshot): { pose: SpritePoseKey; facing: 'r' | 'l' } {
  const facing: 'r' | 'l' = snapshot.pose.facing === -1 ? 'l' : 'r';
  const { action, t, pose } = snapshot;

  if (action === 'sleep') {
    return { pose: Math.floor(t / 8) % 2 === 0 ? 'sleep_0' : 'sleep_1', facing };
  }
  if (action === 'echo') {
    const f = pose.armMode === 'typeR' || (pose.armMode !== 'typeL' && t % 4 >= 2) ? 'type_1' : 'type_0';
    return { pose: f, facing };
  }
  if (
    action === 'oops' ||
    action === 'sad' ||
    action === 'bonk' ||
    action === 'zap' ||
    action === 'shrug' ||
    action === 'spin' ||
    action === 'shoo'
  ) {
    return { pose: Math.floor(t / 3) % 2 === 0 ? 'oops_0' : 'oops_1', facing };
  }
  if (
    action === 'celebrate' ||
    action === 'hello' ||
    action === 'pet' ||
    action === 'highfive' ||
    action === 'found' ||
    action === 'wake'
  ) {
    return { pose: Math.floor(t / 3) % 2 === 0 ? 'happy_0' : 'happy_1', facing };
  }
  if (action === 'edit' || action === 'skill' || action === 'compact' || action === 'poof') {
    return { pose: Math.floor(t / 3) % 2 === 0 ? 'code_0' : 'code_1', facing };
  }
  if (action === 'shell' || action === 'mcp' || action === 'fetch') {
    return { pose: Math.floor(t / 3) % 2 === 0 ? 'term_0' : 'term_1', facing };
  }
  if (action === 'read' || action === 'search' || action === 'plan' || action === 'todo') {
    return { pose: Math.floor(t / 4) % 2 === 0 ? 'read_0' : 'read_1', facing };
  }
  if (action === 'walk') {
    const isStepB = pose.legMode === 'stepB' || (pose.legMode !== 'stepA' && Math.floor(t / 3) % 2 === 1);
    return { pose: isStepB ? 'walk_1' : 'walk_0', facing };
  }

  if (pose.eyeMode === 'happy' || pose.armMode === 'cheer' || pose.armMode === 'waveL' || pose.armMode === 'waveR') {
    return { pose: Math.floor(t / 3) % 2 === 0 ? 'happy_0' : 'happy_1', facing };
  }
  if (pose.eyeMode === 'dizzy') {
    return { pose: Math.floor(t / 3) % 2 === 0 ? 'oops_0' : 'oops_1', facing };
  }
  if (pose.armMode === 'wandUp' || pose.armMode === 'wandDown') {
    return { pose: pose.armMode === 'wandUp' ? 'code_1' : 'code_0', facing };
  }
  if (pose.eyeMode === 'down') {
    return { pose: 'read_0', facing };
  }
  if (pose.eyeMode === 'blink' || pose.earMode === 'twitch' || t % 16 >= 12) {
    return { pose: 'idle_1', facing };
  }

  return { pose: 'idle_0', facing };
}

/** Upload PNG bytes once using Kitty Graphics Protocol chunked base64 (q=2 suppresses OK replies). */
export function encodeKittyUpload(imageId: number, pngBytes: Uint8Array): string {
  const b64 = Buffer.from(pngBytes).toString('base64');
  const chunkSize = 4096;
  if (b64.length === 0) return '';

  let out = '';
  for (let offset = 0, chunkIdx = 0; offset < b64.length; offset += chunkSize, chunkIdx++) {
    const slice = b64.slice(offset, offset + chunkSize);
    const more = offset + chunkSize < b64.length ? 1 : 0;
    if (chunkIdx === 0) {
      out += `\x1b_Ga=t,f=100,i=${imageId},q=2,m=${more};${slice}\x1b\\`;
    } else {
      out += `\x1b_Gm=${more};${slice}\x1b\\`;
    }
  }
  return out;
}

/** Place an already-uploaded Kitty image at a 1-based terminal cell position. */
export function encodeKittyPlace(
  imageId: number,
  row1Based: number,
  col1Based: number,
  cols: number,
  rows: number,
  placementId = 1
): string {
  return `\x1b[${row1Based};${col1Based}H\x1b_Ga=p,i=${imageId},p=${placementId},c=${cols},r=${rows},C=1,z=-1,q=2\x1b\\`;
}

/** Delete only the placement (lowercase d=i) so the uploaded PNG stays cached in terminal RAM. */
export function encodeKittyDeletePlacement(imageId: number, placementId = 1): string {
  return `\x1b_Ga=d,d=i,i=${imageId},p=${placementId},q=2\x1b\\`;
}

/** Delete all Kitty graphics images and placements (uppercase d=A) on cleanup. */
export function encodeKittyDeleteAll(): string {
  return `\x1b_Ga=d,d=A,q=2\x1b\\`;
}

function rleSixelRow(masks: Uint8Array): string {
  let end = masks.length;
  while (end > 0 && masks[end - 1] === 0) end--;
  if (end === 0) return '';

  let out = '';
  let i = 0;
  while (i < end) {
    const ch = String.fromCharCode(63 + masks[i]!);
    let j = i + 1;
    while (j < end && masks[j] === masks[i]) j++;
    const run = j - i;
    out += run >= 4 ? `!${run}${ch}` : ch.repeat(run);
    i = j;
  }
  return out;
}

/** Pure TypeScript RGBA buffer -> transparent-background Sixel encoder (P2=1, RLE). */
export function encodeRgbaToSixel(rgba: Uint8Array, width: number, height: number, maxColors = 64): string {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return `\x1bP0;1;0q"1;1;${Math.max(1, width)};${Math.max(1, height)}\x1b\\`;
  }

  const palette: Array<[number, number, number]> = [];
  const colorToIdx = new Map<number, number>();
  const grid = new Int16Array(width * height).fill(-1);

  const buildGrid = (shift: number): boolean => {
    palette.length = 0;
    colorToIdx.clear();
    const mask = ~((1 << shift) - 1) & 0xff;
    for (let i = 0; i < width * height; i++) {
      const base = i * 4;
      const a = rgba[base + 3]!;
      if (a < 128) {
        grid[i] = -1;
        continue;
      }
      const r = rgba[base]! & mask;
      const g = rgba[base + 1]! & mask;
      const b = rgba[base + 2]! & mask;
      const key = (r << 16) | (g << 8) | b;
      let idx = colorToIdx.get(key);
      if (idx === undefined) {
        if (palette.length >= maxColors) return false;
        idx = palette.length;
        palette.push([r, g, b]);
        colorToIdx.set(key, idx);
      }
      grid[i] = idx;
    }
    return true;
  };

  for (let shift = 2; shift <= 6; shift++) {
    if (buildGrid(shift)) break;
  }

  if (palette.length === 0) {
    return `\x1bP0;1;0q"1;1;${width};${height}\x1b\\`;
  }

  let out = `\x1bP0;1;0q"1;1;${width};${height}`;
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = palette[i]!;
    out += `#${i};2;${Math.round((r * 100) / 255)};${Math.round((g * 100) / 255)};${Math.round((b * 100) / 255)}`;
  }

  const rowMasks = new Uint8Array(width);
  for (let bandY = 0; bandY < height; bandY += 6) {
    const bh = Math.min(6, height - bandY);
    const bandColors = new Set<number>();
    for (let dy = 0; dy < bh; dy++) {
      const rowOffset = (bandY + dy) * width;
      for (let x = 0; x < width; x++) {
        const ci = grid[rowOffset + x]!;
        if (ci >= 0) bandColors.add(ci);
      }
    }

    if (bandColors.size === 0) {
      out += '-';
      continue;
    }

    let firstInBand = true;
    for (const ci of [...bandColors].sort((a, b) => a - b)) {
      rowMasks.fill(0);
      for (let dy = 0; dy < bh; dy++) {
        const rowOffset = (bandY + dy) * width;
        for (let x = 0; x < width; x++) {
          if (grid[rowOffset + x] === ci) {
            rowMasks[x] = rowMasks[x]! | (1 << dy);
          }
        }
      }
      const encoded = rleSixelRow(rowMasks);
      if (encoded) {
        if (!firstInBand) out += '$';
        out += `#${ci}${encoded}`;
        firstInBand = false;
      }
    }
    out += '-';
  }

  out += '\x1b\\';
  return out;
}

function helperPlacementBox(
  h: RenderHelper,
  cols: number,
  bandTopRow1Based: number
): { row: number; col: number; wCols: number; hRows: number } {
  const wCols = h.depth > 2 ? 2 : h.depth > 1 ? 4 : 6;
  const hRows = h.depth > 2 ? 1 : h.depth > 1 ? 2 : 3;
  const rowOff = h.depth > 2 ? 5 : h.depth > 1 ? (h.hopDy < 0 ? 3 : 4) : h.hopDy < 0 ? 2 : 3;
  const row = bandTopRow1Based + Math.max(0, Math.min(BAND_ROWS - hRows, rowOff));
  const col = Math.max(1, Math.min(Math.max(1, cols - wCols + 1), h.x + 1));
  return { row, col, wCols, hRows };
}

export class SpriteRenderer {
  readonly protocol: GfxProtocol;
  readonly assetsLoaded: boolean;
  private frames = new Map<`${SpritePoseKey}_${'r' | 'l'}`, LoadedAsset>();
  private kittens = new Map<string, KittenVariantAssets>();
  private fallbackKitten: KittenVariantAssets | null = null;
  private uploadedIds = new Set<number>();
  private activeKittyPlacements: Array<{ imageId: number; placementId: number }> = [];

  constructor(
    requested: 'auto' | GfxProtocol = 'auto',
    assetsDir: string = join(import.meta.dir, '..', 'assets', 'sprites'),
    env: Record<string, string | undefined> = process.env
  ) {
    const detected = detectGfxProtocol(env, requested);
    const loaded = this.loadAssets(assetsDir);
    if (!loaded && detected !== 'halfblock') {
      this.protocol = 'halfblock';
      this.assetsLoaded = false;
    } else {
      this.protocol = detected;
      this.assetsLoaded = loaded;
    }
  }

  private loadAssetPair(assetsDir: string, pngRel: string, sixelRel: string, kittyId: number): LoadedAsset | null {
    const pngFile = join(assetsDir, pngRel);
    const sixelFile = join(assetsDir, sixelRel);
    if (!existsSync(pngFile) || !existsSync(sixelFile)) return null;
    return {
      kittyId,
      pngBytes: readFileSync(pngFile),
      sixel: readFileSync(sixelFile, 'ascii'),
    };
  }

  private loadAssets(assetsDir: string): boolean {
    const manifestPath = join(assetsDir, 'manifest.json');
    if (!existsSync(manifestPath)) return false;

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SpriteManifest;
      if (!Array.isArray(manifest.poses) || manifest.poses.length === 0) return false;

      let nextId = 101;
      for (const entry of manifest.poses) {
        if (!ALL_POSES.includes(entry.pose)) continue;
        for (const side of ['r', 'l'] as const) {
          const loaded = this.loadAssetPair(
            assetsDir,
            side === 'r' ? entry.rightPng : entry.leftPng,
            side === 'r' ? entry.rightSixel : entry.leftSixel,
            nextId++
          );
          if (!loaded) return false;
          this.frames.set(`${entry.pose}_${side}` as const, loaded);
        }
      }

      if (Array.isArray(manifest.kittens)) {
        let nextKittenId = 201;
        for (const k of manifest.kittens) {
          const plainOpen = this.loadAssetPair(assetsDir, k.plainOpenPng, k.plainOpenSixel, nextKittenId++);
          const plainBlink = this.loadAssetPair(assetsDir, k.plainBlinkPng, k.plainBlinkSixel, nextKittenId++);
          const wfOpen = this.loadAssetPair(assetsDir, k.wfOpenPng, k.wfOpenSixel, nextKittenId++);
          const wfBlink = this.loadAssetPair(assetsDir, k.wfBlinkPng, k.wfBlinkSixel, nextKittenId++);
          if (!plainOpen || !plainBlink || !wfOpen || !wfBlink) continue;
          const variants: KittenVariantAssets = { plainOpen, plainBlink, wfOpen, wfBlink };
          this.kittens.set(k.color.toLowerCase(), variants);
          if (!this.fallbackKitten) this.fallbackKitten = variants;
        }
      }

      return this.frames.size === ALL_POSES.length * 2;
    } catch {
      this.frames.clear();
      this.kittens.clear();
      this.fallbackKitten = null;
      return false;
    }
  }

  usesImageProtocol(): boolean {
    return this.protocol === 'kitty' || this.protocol === 'sixel';
  }

  private resolveKittenAsset(h: RenderHelper): LoadedAsset | null {
    const variants = this.kittens.get(h.color.toLowerCase()) ?? this.fallbackKitten;
    if (!variants) return null;
    if (h.isWorkflow) return h.blink ? variants.wfBlink : variants.wfOpen;
    return h.blink ? variants.plainBlink : variants.plainOpen;
  }

  /** Compute a cache key contribution so image-only pose/x or kitten helper changes trigger repaints. */
  overlayKey(snapshot: RenderSnapshot, cols: number): string {
    if (!this.usesImageProtocol()) return '';
    const { pose, facing } = selectSpritePose(snapshot);
    const imgCol = this.computeImageCol(snapshot, cols);
    const helpersKey = snapshot.helpers
      .map((h) => `${h.id}:${h.x}:${h.depth}:${h.color}:${h.isWorkflow ? 1 : 0}:${h.hopDy}:${h.blink ? 1 : 0}`)
      .join(',');
    return `${this.protocol}:${pose}_${facing}@${imgCol}|${helpersKey}`;
  }

  private computeImageCol(snapshot: RenderSnapshot, cols: number): number {
    const spriteX = Math.max(0, Math.min(Math.max(0, cols - SPRITE_W), snapshot.x + snapshot.pose.dx));
    return Math.max(0, Math.min(Math.max(0, cols - SPRITE_IMG_COLS), spriteX + SPRITE_IMG_COL_OFFSET));
  }

  /** Lazy upload on first use keeps startup instantaneous over SSH. */
  initSequence(): string {
    return '';
  }

  /** Emit Kitty placements (main catgirl + subagent kittens) or Sixel rasters inside the bottom band. */
  renderOverlay(snapshot: RenderSnapshot, cols: number, bandTopRow1Based: number): string {
    if (!this.usesImageProtocol() || !this.assetsLoaded) return '';
    const { pose, facing } = selectSpritePose(snapshot);
    const frame = this.frames.get(`${pose}_${facing}`);
    if (!frame) return '';

    const col1Based = this.computeImageCol(snapshot, cols) + 1;

    if (this.protocol === 'kitty') {
      let out = '';
      for (const prev of this.activeKittyPlacements) {
        out += encodeKittyDeletePlacement(prev.imageId, prev.placementId);
      }
      this.activeKittyPlacements = [];

      // Place helper kittens behind/beside main character (placementIds 10, 11, ...)
      for (let i = 0; i < snapshot.helpers.length; i++) {
        const h = snapshot.helpers[i]!;
        const kAsset = this.resolveKittenAsset(h);
        if (!kAsset) continue;
        if (!this.uploadedIds.has(kAsset.kittyId)) {
          out += encodeKittyUpload(kAsset.kittyId, kAsset.pngBytes);
          this.uploadedIds.add(kAsset.kittyId);
        }
        const box = helperPlacementBox(h, cols, bandTopRow1Based);
        const placementId = 10 + i;
        out += encodeKittyPlace(kAsset.kittyId, box.row, box.col, box.wCols, box.hRows, placementId);
        this.activeKittyPlacements.push({ imageId: kAsset.kittyId, placementId });
      }

      // Place main Gemini catgirl (placementId 1)
      if (!this.uploadedIds.has(frame.kittyId)) {
        out += encodeKittyUpload(frame.kittyId, frame.pngBytes);
        this.uploadedIds.add(frame.kittyId);
      }
      out += encodeKittyPlace(frame.kittyId, bandTopRow1Based, col1Based, SPRITE_IMG_COLS, BAND_ROWS, 1);
      this.activeKittyPlacements.push({ imageId: frame.kittyId, placementId: 1 });
      return out;
    }

    // Sixel: draw helper kittens first, then main Gemini catgirl on top
    let out = '';
    for (const h of snapshot.helpers) {
      const kAsset = this.resolveKittenAsset(h);
      if (!kAsset) continue;
      const box = helperPlacementBox(h, cols, bandTopRow1Based);
      out += `\x1b[${box.row};${box.col}H${kAsset.sixel}`;
    }
    out += `\x1b[${bandTopRow1Based};${col1Based}H${frame.sixel}`;
    return out;
  }

  /** Clean up active placements/images on exit or protocol switch. */
  clearSequence(): string {
    if (this.protocol === 'kitty') {
      this.activeKittyPlacements = [];
      this.uploadedIds.clear();
      return encodeKittyDeleteAll();
    }
    return '';
  }
}
