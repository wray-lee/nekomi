/** Twelve distinct hues for subagent helper sprites (avoiding Gemini's blue-violet body & workflow purple hat). */
export const HELPER_PALETTE = [
  '#ff5f87',
  '#ffd75f',
  '#87d75f',
  '#5fd7af',
  '#5fd7ff',
  '#ff9e64',
  '#ff87d7',
  '#d7ff87',
  '#73daca',
  '#f7768e',
  '#ffffaf',
  '#4ec9b0',
] as const;

export const WORKFLOW_HAT_COLOR = '#9d4edd';

/** Pick a helper color not currently in use on screen, cycling once all 12 are taken. */
export function pickHelperColor(taken: Iterable<string> = [], random = Math.random): string {
  const used = new Set(taken);
  const free = HELPER_PALETTE.filter((c) => !used.has(c));
  const pool = free.length ? free : HELPER_PALETTE;
  return pool[Math.floor(random() * pool.length)]!;
}
