import { SPRITE_W } from './engine';
import {
  BAND_ROWS,
  PIXEL_H,
  PIXEL_W,
  buildHelperPixelGrid,
  buildTuiPixelGrid,
  hexToRgb,
} from './tui-sprite';
import type { FxItem, RenderSnapshot } from './types';

type Tone = 'none' | 'body' | 'helper' | 'fx';

interface Cell {
  ch: string;
  fg?: string;
  bg?: string;
  tone: Tone;
}

/** 2-pixel-per-cell vertical composer over a 6-row x cols terminal band. */
class BandBuffer {
  readonly cols: number;
  readonly rows = BAND_ROWS;
  private topPx: Array<Array<string | null>>;
  private botPx: Array<Array<string | null>>;
  private textCells: Array<Array<Cell | null>>;
  private tones: Tone[][];

  constructor(cols: number) {
    this.cols = Math.max(1, cols);
    this.topPx = Array.from({ length: this.rows }, () => Array<string | null>(this.cols).fill(null));
    this.botPx = Array.from({ length: this.rows }, () => Array<string | null>(this.cols).fill(null));
    this.textCells = Array.from({ length: this.rows }, () => Array<Cell | null>(this.cols).fill(null));
    this.tones = Array.from({ length: this.rows }, () => Array<Tone>(this.cols).fill('none'));
  }

  setPixel(pxRow: number, col: number, color: string | null, tone: Tone): void {
    if (!color || col < 0 || col >= this.cols || pxRow < 0 || pxRow >= PIXEL_H) return;
    const termRow = Math.floor(pxRow / 2);
    const isTop = pxRow % 2 === 0;
    if (isTop) this.topPx[termRow]![col] = color;
    else this.botPx[termRow]![col] = color;
    this.textCells[termRow]![col] = null;
    this.tones[termRow]![col] = tone;
  }

  drawPixelGrid(col0: number, pxRow0: number, grid: Array<Array<string | null>>, tone: Tone): void {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r]!;
      for (let c = 0; c < row.length; c++) {
        const color = row[c] ?? null;
        if (color) this.setPixel(pxRow0 + r, col0 + c, color, tone);
      }
    }
  }

  putText(termRow: number, col: number, text: string, fg?: string, tone: Tone = 'fx', soft = false): void {
    if (termRow < 0 || termRow >= this.rows) return;
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      const c = col + i;
      if (c < 0 || c >= this.cols) continue;
      const ch = chars[i]!;
      if (ch === ' ') continue;
      if (soft && this.tones[termRow]![c] !== 'none') continue;
      this.textCells[termRow]![c] = { ch, fg, tone };
      this.topPx[termRow]![c] = null;
      this.botPx[termRow]![c] = null;
      this.tones[termRow]![c] = tone;
    }
  }

  toAnsiLines(): string[] {
    const lines: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let line = '';
      for (let c = 0; c < this.cols; c++) {
        const tc = this.textCells[r]![c];
        if (tc) {
          if (tc.fg) {
            const [R, G, B] = hexToRgb(tc.fg);
            line += `\x1b[38;2;${R};${G};${B}m${tc.ch}\x1b[0m`;
          } else {
            line += tc.ch;
          }
          continue;
        }
        const top = this.topPx[r]![c];
        const bot = this.botPx[r]![c];
        if (!top && !bot) {
          line += ' ';
        } else if (top && !bot) {
          const [R, G, B] = hexToRgb(top);
          line += `\x1b[38;2;${R};${G};${B}m▀\x1b[0m`;
        } else if (!top && bot) {
          const [R, G, B] = hexToRgb(bot);
          line += `\x1b[38;2;${R};${G};${B}m▄\x1b[0m`;
        } else if (top === bot) {
          const [R, G, B] = hexToRgb(top!);
          line += `\x1b[38;2;${R};${G};${B}m█\x1b[0m`;
        } else {
          const [r1, g1, b1] = hexToRgb(top!);
          const [r2, g2, b2] = hexToRgb(bot!);
          line += `\x1b[38;2;${r1};${g1};${b1};48;2;${r2};${g2};${b2}m▀\x1b[0m`;
        }
      }
      lines.push(line);
    }
    return lines;
  }
}

function drawTuiFx(buf: BandBuffer, fx: FxItem, spriteX: number, spritePxY: number, cols: number): void {
  const onRight = spriteX + SPRITE_W + 6 <= cols;
  const sideX = onRight ? spriteX + SPRITE_W + 1 : Math.max(0, spriteX - 6);
  const baseRow = Math.max(0, Math.min(BAND_ROWS - 1, Math.floor(spritePxY / 2)));
  const phase = fx.phase ?? 0;
  const color = fx.color ?? '#ffd75f';

  switch (fx.kind) {
    case 'star': {
      const ch = phase % 2 === 0 ? '✦' : '✧';
      const r = Math.max(0, Math.min(BAND_ROWS - 1, baseRow + Math.round(fx.dy / 3)));
      const c = Math.max(0, Math.min(cols - 1, spriteX + Math.round((fx.dx * 16) / 24)));
      buf.putText(r, c, ch, color, 'fx');
      break;
    }
    case 'wandSpark': {
      const rx = onRight ? spriteX + SPRITE_W : Math.max(0, spriteX - 4);
      if (phase === 1) {
        buf.putText(3, rx, '╱✦*', '#8eeeff', 'fx');
        buf.putText(4, rx + 1, '✧', '#ffd75f', 'fx');
      } else {
        buf.putText(2, rx, '✦', '#fff3a1', 'fx');
        buf.putText(3, rx, '╲', '#865ce6', 'fx');
      }
      break;
    }
    case 'holoTerm': {
      const rx = onRight ? spriteX + SPRITE_W + 1 : Math.max(0, spriteX - 5);
      buf.putText(2, rx, '┌──┐', '#5fd7af', 'fx');
      buf.putText(3, rx, phase < 3 ? '│>_│' : '│> │', '#87d787', 'fx');
      buf.putText(4, rx, '└──┘', '#5fd7af', 'fx');
      break;
    }
    case 'book': {
      const rx = onRight ? spriteX + SPRITE_W + 1 : Math.max(0, spriteX - 5);
      buf.putText(3, rx, phase === 1 ? '▛▀▜' : '▛▄▜', '#865ce6', 'fx');
      buf.putText(4, rx, '▙█▟', '#f5f3ff', 'fx');
      break;
    }
    case 'lens': {
      const rx = onRight ? spriteX + SPRITE_W + 1 : Math.max(0, spriteX - 4);
      buf.putText(2, rx, '╭─╮', '#8eeeff', 'fx');
      buf.putText(3, rx, '╰O╯', '#ffd75f', 'fx');
      buf.putText(4, rx, onRight ? '╱' : '╲', '#865ce6', 'fx');
      break;
    }
    case 'progressBar': {
      const total = 10;
      const fill = Math.max(1, (phase % total) + 1);
      const bar = '[' + '='.repeat(fill) + '.'.repeat(total - fill) + ']';
      buf.putText(0, Math.max(0, spriteX + 2), bar, '#70d6ff', 'fx');
      break;
    }
    case 'comets': {
      const offsets = [-2, 1, 5, 10, 14, 17];
      const idx = phase % offsets.length;
      const idx2 = (phase + 3) % offsets.length;
      buf.putText(0, spriteX + offsets[idx]!, '✦', '#ffd75f', 'fx');
      buf.putText(1, spriteX + offsets[idx2]!, '✧', '#c77dff', 'fx');
      break;
    }
    case 'haloWaves': {
      const reach = (phase % 3) + 1;
      buf.putText(1, spriteX + 13, '|', '#5fd7ff', 'fx');
      for (let i = 1; i <= reach; i++) {
        buf.putText(1, spriteX + 13 + i, ')', '#5fd7ff', 'fx');
        buf.putText(1, spriteX + 13 - i, '(', '#5fd7ff', 'fx');
      }
      break;
    }
    case 'checklist': {
      const rx = onRight ? spriteX + SPRITE_W + 1 : Math.max(0, spriteX - 5);
      buf.putText(2, rx, phase >= 0 ? '[x]' : '[ ]', '#87d787', 'fx');
      buf.putText(3, rx, phase >= 1 ? '[x]' : '[ ]', '#87d787', 'fx');
      buf.putText(4, rx, phase >= 2 ? '[x]' : '[ ]', '#a9b1d6', 'fx');
      break;
    }
    case 'blueprint': {
      const rx = onRight ? spriteX + SPRITE_W + 1 : Math.max(0, spriteX - 6);
      const routes = ['o  ', 'o- ', 'o->', 'o->', 'o->'];
      const rStr = routes[phase % routes.length]!;
      buf.putText(2, rx, '▛▀▀▀▜', '#5fd7ff', 'fx');
      buf.putText(3, rx, `▌${rStr}▐`, '#ffd75f', 'fx');
      buf.putText(4, rx, '▙▄▄▄▟', '#5fd7ff', 'fx');
      break;
    }
    case 'squeeze': {
      const off = phase % 2 === 0 ? 1 : 0;
      buf.putText(3, Math.max(0, spriteX - 3 + off), '>>', '#c77dff', 'fx');
      buf.putText(3, Math.min(cols - 2, spriteX + SPRITE_W + 1 - off), '<<', '#c77dff', 'fx');
      break;
    }
    case 'confetti': {
      const glyphs = ['▘', '▝', '▗', '▖'];
      const r = Math.max(0, Math.min(BAND_ROWS - 1, Math.floor((fx.dy % 12) / 2)));
      const c = Math.max(0, Math.min(cols - 1, spriteX + Math.round((fx.dx * 16) / 24)));
      buf.putText(r, c, glyphs[phase % 4]!, color, 'fx');
      break;
    }
    case 'heart': {
      buf.putText(0, Math.max(0, spriteX + 7), '<3', color, 'fx');
      break;
    }
    case 'sleepZ': {
      const zs = ['z', 'Z', 'z', 'Z'];
      buf.putText(Math.max(0, 2 - (phase % 3)), Math.min(cols - 1, spriteX + SPRITE_W), zs[phase % 4]!, '#87afff', 'fx');
      break;
    }
    case 'tear': {
      buf.putText(3, spriteX + 5, '·', '#70d6ff', 'fx');
      break;
    }
    case 'smoke': {
      buf.putText(Math.max(0, 2 - phase), spriteX + 6, '~~~', color, 'fx');
      break;
    }
    case 'static': {
      buf.putText(1, Math.min(cols - 3, spriteX + 12), phase % 2 === 0 ? '#~#' : '~#~', color, 'fx');
      break;
    }
    case 'musicNote': {
      buf.putText(Math.max(0, Math.min(2, Math.floor(fx.dy / 2))), Math.min(cols - 1, sideX), fx.text ?? '♪', color, 'fx');
      break;
    }
    case 'bubble': {
      const txt = fx.text ?? '!';
      const r = txt === '!' || txt === '-.-' || txt === '!?' || txt === 'o.o' || txt.startsWith('o') || txt.startsWith('a') ? 0 : 1;
      const c = fx.dx > 18 ? Math.min(cols - txt.length, spriteX + SPRITE_W + 1) : Math.max(0, spriteX + 6);
      buf.putText(r, c, txt, color, 'fx');
      break;
    }
  }
}

export function renderBand(
  snapshot: RenderSnapshot,
  cols: number,
  options?: { omitMainSprite?: boolean }
): string[] {
  const buf = new BandBuffer(cols);
  const spriteX = Math.max(0, Math.min(Math.max(0, cols - PIXEL_W), snapshot.x + snapshot.pose.dx));
  const spritePxY = Math.max(-2, Math.min(2, Math.round(snapshot.pose.dy)));

  // 1. Render subagent kittens (half-block fallback; Kitty/Sixel draws high-res kittens instead)
  if (!options?.omitMainSprite) {
    for (const h of snapshot.helpers) {
      const hGrid = buildHelperPixelGrid(h.color, h.depth, h.isWorkflow, h.blink);
      const pxRow0 = Math.max(0, PIXEL_H - hGrid.length + h.hopDy * 2);
      buf.drawPixelGrid(h.x, pxRow0, hGrid, 'helper');
    }
  }

  // 2. Render overflow helpers count (+N) in corner
  const ov = snapshot.overflowHelpers;
  const totalOv = ov.plain + ov.workflow;
  if (totalOv > 0 && cols >= 6) {
    const tag = `+${totalOv}`;
    buf.putText(1, Math.max(0, cols - tag.length - 1), tag, ov.workflow > 0 ? '#9d4edd' : '#cdd6f4', 'helper', true);
    ov.colors.slice(0, 3).forEach((c, i) => {
      buf.putText(2, Math.max(0, cols - 3 + i), '▀', c, 'helper', true);
    });
  }

  // 3. Render main Gemini character (omitted when Kitty/Sixel image overlay handles it)
  if (!options?.omitMainSprite) {
    const grid = buildTuiPixelGrid(snapshot.pose);
    buf.drawPixelGrid(spriteX, spritePxY, grid, 'body');
  }

  // 4. Render FX
  // In image-protocol mode, all character props & animations are baked directly into the 48x48 sprites;
  // only keep the live typed-character bubble during typing echo.
  for (const fx of snapshot.pose.fx) {
    if (options?.omitMainSprite && !(snapshot.action === 'echo' && fx.kind === 'bubble')) {
      continue;
    }
    drawTuiFx(buf, fx, spriteX, spritePxY, cols);
  }

  return buf.toAnsiLines();
}

export function isBodyHit(snapshot: RenderSnapshot, col1Based: number, bandRow1Based: number): boolean {
  const col = col1Based - 1;
  const row = bandRow1Based - 1;
  const spriteX = snapshot.x + snapshot.pose.dx;
  return col >= spriteX - 1 && col <= spriteX + PIXEL_W && row >= 0 && row < BAND_ROWS;
}
