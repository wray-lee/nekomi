export type InputToken =
  | { kind: 'mouse'; raw: string; btn: number; col: number; row: number; release: boolean }
  | { kind: 'data'; raw: string };

const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** Split terminal stdin chunk into SGR mouse events and raw key/text data. */
export function parseTerminalInput(chunk: string): InputToken[] {
  const tokens: InputToken[] = [];
  let lastIndex = 0;
  SGR_MOUSE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SGR_MOUSE_RE.exec(chunk)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'data', raw: chunk.slice(lastIndex, match.index) });
    }
    tokens.push({
      kind: 'mouse',
      raw: match[0],
      btn: Number(match[1]),
      col: Number(match[2]),
      row: Number(match[3]),
      release: match[4] === 'm',
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < chunk.length) {
    tokens.push({ kind: 'data', raw: chunk.slice(lastIndex) });
  }
  return tokens;
}

/** Extract last printable character from a non-escape stdin chunk for typing echo. */
export function extractPrintableChar(raw: string): string | null {
  if (!raw || raw.startsWith('\x1b')) return null;
  const chars = [...raw].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
  return chars.length ? chars[chars.length - 1]! : null;
}

/**
 * Translate an SGR mouse token directed at the upper child pane.
 * If the child enabled mouse reporting, forward verbatim; otherwise turn scroll wheel into PageUp/PageDown.
 */
export function translateMouseForChild(
  tok: Extract<InputToken, { kind: 'mouse' }>,
  childMouseEnabled: boolean
): string | null {
  if (childMouseEnabled) return tok.raw;
  if (!tok.release && tok.btn === 64) return '\x1b[5~';
  if (!tok.release && tok.btn === 65) return '\x1b[6~';
  return null;
}
