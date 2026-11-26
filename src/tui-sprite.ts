import type { ArmMode, EarMode, EyeMode, LegMode, Pose } from './types';

export const PIXEL_W = 16;
export const PIXEL_H = 12; // 6 terminal rows using half-block '▀'
export const BAND_ROWS = 6;

export const SPRITE_COLORS: Record<string, string | null> = {
  '.': null,
  // Hair & cat ears (sky-blue -> periwinkle -> lavender -> pink-lilac gradient)
  A: '#5b7cfa', // outer ear / shadow
  B: '#6ea8ff', // sky-blue upper hair
  C: '#8f84ff', // periwinkle mid hair
  D: '#b97aff', // lavender lower hair
  E: '#e888f7', // pink-violet hair tips
  I: '#f7ebff', // inner cat-ear fluff
  // Gemini 4-pointed star hairpin & accents
  S: '#8eeeff', // cyan star facet
  G: '#fff3a1', // bright gold star core
  // Face & heterochromia eyes
  K: '#ffe8dc', // soft anime skin
  P: '#ff8fb1', // rosy cheek blush
  R: '#ff2b78', // right eye (magenta-red)
  Y: '#ffae1f', // left eye (golden-amber)
  W: '#ffffff', // eye catchlight / white frill
  X: '#241c4e', // dark indigo outline / kimono
  // Outfit
  U: '#342975', // indigo kimono sleeves
  V: '#865ce6', // violet sash
  F: '#f5f3ff', // white skirt frills / cuffs
};

function eyeRows(mode: EyeMode): [string, string] {
  // 8 chars wide inside face (cols 4..11)
  switch (mode) {
    case 'blink':
      return ['KKKKKKKK', 'KXXKKXXK'];
    case 'happy':
      return ['KKXKKXKK', 'KXKKKKXK'];
    case 'lookL':
      return ['WRKKWYKK', 'XRKKXYKK'];
    case 'lookR':
      return ['KKRWKKYW', 'KKRXKKYX'];
    case 'down':
      return ['KKKKKKKK', 'KRXKKYXK'];
    case 'wide':
      return ['WRWKKWYW', 'RRRKKYYY'];
    case 'dizzy':
      return ['XKKKKKKX', 'KXKKKKXK'];
    default:
      return ['KWRKKWYK', 'KRRKKYYK'];
  }
}

function bodyRows(arm: ArmMode, leg: LegMode): [string, string, string, string] {
  // Rows 8..11 (16 cols each)
  const r8 =
    arm === 'up' || arm === 'cheer'
      ? '.AEFXUVGVUXF.EA.'
      : arm === 'waveR' || arm === 'holdR'
        ? '.AEE.XUVGVUXF.EA'
        : arm === 'waveL' || arm === 'holdL'
          ? 'AE.FXUVGVUX.EEA.'
          : arm === 'wandUp'
            ? '.AEE.XUVGVUXSGEA'
            : '.AEE.XUVGVUX.EEA';

  const r9 =
    arm === 'up' || arm === 'cheer'
      ? '..AE.XUUUUUX.EA.'
      : arm === 'typeL'
        ? '..AF.XUUUUUX.EA.'
        : arm === 'typeR'
          ? '..AE.XUUUUUX.FA.'
          : arm === 'wandDown'
            ? '..AE.XUUUUUXSGA.'
            : '..AEFXUUUUUXFEA.';

  const r10 = leg === 'crouch' ? '...E.XFFWFFX.E..' : '...E.XFFWFFX.E..';

  const r11 =
    leg === 'stepA'
      ? '....XU...XU.....'
      : leg === 'stepB'
        ? '.....UX...UX....'
        : leg === 'hop'
          ? '....XU....UX....'
          : leg === 'crouch'
            ? '....XX....XX....'
            : '.....XU..UX.....';

  return [r8, r9, r10, r11];
}

export function buildTuiPixelGrid(pose: Required<Omit<Pose, 'fx'>>): Array<Array<string | null>> {
  const [e1, e2] = eyeRows(pose.eyeMode);
  const cheek = pose.blush ? 'PPKKKKPP' : 'PKKKKKKP';
  const [r8, r9, r10, r11] = bodyRows(pose.armMode, pose.legMode);

  const rawRows = [
    '.......AA.......', // 0: ahoge
    '...AA.B...AA....', // 1: cat ear tips
    '..AIIABBBBAIIA..', // 2: cat ears + sky-blue crown
    '.ABBBBBBBBBBBSA.', // 3: bangs + star clip top
    '.ACBBKKKKKKKGSGA', // 4: buns + forehead + star clip center
    `.ADC${e1}KSA.`, // 5: heterochromia eyes top + star bottom
    `.ADC${e2}KDA.`, // 6: heterochromia eyes bottom
    `.AEK${cheek}KEA.`, // 7: rosy cheeks + pink-lavender hair
    r8,
    r9,
    r10,
    r11,
  ];

  const grid: Array<Array<string | null>> = rawRows.map((row) =>
    [...row.padEnd(PIXEL_W, '.').slice(0, PIXEL_W)].map((ch) => SPRITE_COLORS[ch] ?? null)
  );

  const ear: EarMode = pose.earMode;
  if (ear === 'perk') {
    grid[0]![3] = SPRITE_COLORS.A!;
    grid[0]![11] = SPRITE_COLORS.A!;
  } else if (ear === 'droop') {
    grid[1]![3] = null;
    grid[1]![4] = null;
    grid[1]![10] = null;
    grid[1]![11] = null;
    grid[2]![1] = SPRITE_COLORS.A!;
    grid[2]![14] = SPRITE_COLORS.A!;
  } else if (ear === 'twitch') {
    grid[1]![11] = null;
    grid[2]![13] = SPRITE_COLORS.I!;
  }

  if (pose.starGlow) {
    grid[3]![13] = '#ffffff';
    grid[4]![12] = '#fff9c4';
    grid[4]![13] = '#ffffff';
    grid[4]![14] = '#9ef6ff';
    grid[5]![13] = '#e9b8ff';
  }

  // Swaying blue-purple gradient tail (cols 13..15, rows 9..11)
  const tailFrames: Array<Array<[number, number, string]>> = [
    [[10, 13, 'B'], [11, 14, 'D'], [11, 15, 'E']],
    [[10, 13, 'B'], [10, 14, 'C'], [9, 15, 'E']],
    [[10, 13, 'B'], [10, 14, 'D'], [10, 15, 'E']],
    [[10, 13, 'B'], [11, 13, 'C'], [11, 14, 'E']],
  ];
  for (const [r, c, k] of tailFrames[pose.tailPhase % 4]!) {
    if (grid[r]![c] === null) grid[r]![c] = SPRITE_COLORS[k]!;
  }

  if (pose.facing === -1) {
    return grid.map((row) => [...row].reverse());
  }
  return grid;
}

/** Build a mini multi-colored pixel kitten helper grid (depth 1: 8px wide, depth 2: 5px, depth 3+: 2x2). */
export function buildHelperPixelGrid(
  color: string,
  depth: number,
  isWorkflow: boolean,
  blink: boolean
): Array<Array<string | null>> {
  const hat = '#9d4edd';
  const eye = '#16161c';
  const star = '#fff3a1';
  const inner = '#ffb8d9';
  const belly = '#fff8fc';
  if (depth > 2) {
    return [
      [color, star],
      [star, color],
    ];
  }
  if (depth > 1) {
    const rows = [
      ...(isWorkflow ? ['.HHH.'] : []),
      'C...C',
      'CICIC',
      blink ? 'CCCCC' : 'CECEC',
      '.CCC.',
    ];
    const map: Record<string, string | null> = { C: color, E: eye, H: hat, I: inner, '.': null };
    return rows.map((r) => [...r].map((ch) => map[ch] ?? null));
  }
  const rows = [
    ...(isWorkflow ? ['..HHHH..', '.HHSHHH.'] : []),
    'C....C..',
    'CI..IC.C',
    'CCCCCC.C',
    blink ? 'CCCCCC.C' : 'CECCECC.',
    '.CBBCC.C',
    '.CC.CC..',
  ];
  const map: Record<string, string | null> = {
    C: color,
    E: eye,
    H: hat,
    S: star,
    I: inner,
    B: belly,
    '.': null,
  };
  return rows.map((r) => [...r].map((ch) => map[ch] ?? null));
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Convert a 2D pixel grid (height = 2*rows) into 24-bit ANSI half-block strings ('▀'). */
export function pixelGridToAnsiRows(grid: Array<Array<string | null>>): string[] {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const out: string[] = [];
  for (let r = 0; r < h; r += 2) {
    let line = '';
    const topRow = grid[r] ?? [];
    const botRow = grid[r + 1] ?? [];
    for (let c = 0; c < w; c++) {
      const top = topRow[c] ?? null;
      const bot = botRow[c] ?? null;
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
    out.push(line);
  }
  return out;
}
