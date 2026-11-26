import { HELPER_PALETTE } from './palette';
import type { ActionCtx, ActionFn, ActionName, FxItem, Pose } from './types';

const HEART = '#ff5f87';
const GOLD = '#ffd75f';
const CYAN = '#70d6ff';
const LAVENDER = '#c77dff';
const MAGENTA = '#ff4d8d';

// Bespoke idle fidgets designed around Gemini gijinka (ears, heterochromia eyes, star clip, kimono sleeves, tail).
const FIDGETS: Array<(lt: number, ctx: ActionCtx) => Pose> = [
  // 1. Happy hop with glowing star hairpin
  (lt) =>
    lt % 10 < 4
      ? { eyeMode: 'happy', armMode: 'cheer', legMode: 'hop', earMode: 'perk', starGlow: true, dy: -3, fx: [{ kind: 'star', dx: 2, dy: -2, color: GOLD }] }
      : { earMode: 'normal', tailPhase: lt % 4 },

  // 2. Cheerful kimono sleeve wave
  (lt) => ({
    eyeMode: 'happy',
    armMode: lt % 4 < 2 ? 'waveR' : 'down',
    earMode: 'twitch',
    blush: true,
    tailPhase: Math.floor(lt / 2) % 4,
  }),

  // 3. Ear & sleeve stretch
  (lt) =>
    lt < 14
      ? { eyeMode: 'happy', armMode: 'up', earMode: 'perk', dy: -1, tailPhase: 2 }
      : { eyeMode: 'blink', armMode: 'down' },

  // 4. Curious heterochromia glance left -> right
  (lt) => ({
    eyeMode: lt < 10 ? 'lookL' : 'lookR',
    earMode: lt % 8 < 4 ? 'twitch' : 'normal',
    tailPhase: Math.floor(lt / 3) % 4,
  }),

  // 5. Idol step twirl (fitting her idol-kimono outfit)
  (lt) => ({
    eyeMode: 'happy',
    armMode: lt % 4 < 2 ? 'waveL' : 'waveR',
    legMode: lt % 4 < 2 ? 'stepA' : 'stepB',
    dx: lt % 4 < 2 ? -1 : 1,
    starGlow: true,
    tailPhase: lt % 4,
  }),

  // 6. Humming a starlight tune
  (lt) => ({
    eyeMode: 'happy',
    armMode: 'down',
    blush: true,
    fx: [{ kind: 'musicNote', dx: 20, dy: lt < 10 ? 2 : 0, color: CYAN, text: lt % 6 < 3 ? '♪' : '~' }],
  }),

  // 7. Sleepy yawn with tail droop
  (lt) => ({
    eyeMode: 'blink',
    earMode: 'droop',
    tailPhase: 0,
    fx: [{ kind: 'bubble', dx: 11, dy: -3, text: lt < 10 ? 'o' : 'O', color: '#a9b1d6' }],
  }),

  // 8. Cute sneeze: a.. -> * star puff
  (lt) =>
    lt < 12
      ? { eyeMode: 'down', earMode: 'droop', fx: [{ kind: 'bubble', dx: 10, dy: -3, text: lt < 6 ? 'a.' : 'a..', color: '#e0e6ff' }] }
      : { eyeMode: 'dizzy', earMode: 'perk', dx: lt % 2, fx: [{ kind: 'star', dx: 20, dy: 4, color: GOLD }] },

  // 9. Twin-star magenta heart
  (lt) => ({
    eyeMode: 'happy',
    blush: true,
    starGlow: true,
    fx: lt < 3 ? [] : [{ kind: 'heart', dx: 10, dy: lt < 12 ? 0 : -3, color: HEART }],
  }),

  // 10. Juggling a glowing 4-pointed mini star
  (lt) => {
    const arcX = [6, 11, 16, 11][Math.floor(lt / 2) % 4]!;
    const arcY = [-2, -5, -2, 0][Math.floor(lt / 2) % 4]!;
    return {
      eyeMode: lt % 8 < 4 ? 'lookL' : 'lookR',
      armMode: lt % 4 < 2 ? 'typeL' : 'typeR',
      starGlow: true,
      fx: [{ kind: 'star', dx: arcX, dy: arcY, color: GOLD }],
    };
  },

  // 11. Playful crouch & pounce
  (lt) =>
    lt < 8
      ? { eyeMode: 'wide', legMode: 'crouch', earMode: 'perk', dy: 2, tailPhase: 3 }
      : lt < 13
        ? { eyeMode: 'happy', armMode: 'cheer', legMode: 'hop', dy: -4, starGlow: true }
        : {},

  // 12. Stargazing twin stars (blue & gold)
  (lt) => ({
    eyeMode: 'wide',
    starGlow: true,
    fx: [
      { kind: 'star', dx: 1, dy: -3, phase: lt % 6 < 3 ? 0 : 1, color: CYAN },
      { kind: 'star', dx: 20, dy: -2, phase: lt % 6 < 3 ? 1 : 0, color: GOLD },
    ],
  }),

  // 13. Idol cheer with starlight sparkles
  (lt) => ({
    eyeMode: 'happy',
    armMode: lt % 4 < 2 ? 'cheer' : 'up',
    blush: true,
    starGlow: true,
    fx: [{ kind: 'star', dx: lt % 4 < 2 ? 0 : 21, dy: 2, color: LAVENDER }],
  }),

  // 14. Nodding off then snapping awake
  (lt) =>
    lt < 14
      ? { eyeMode: 'blink', earMode: 'droop', dy: lt % 6 < 3 ? 0 : 1 }
      : { eyeMode: 'wide', armMode: 'up', earMode: 'perk', starGlow: true, fx: [{ kind: 'bubble', dx: 11, dy: -4, text: '!', color: GOLD }] },
];

const GAP = 80; // 8s per cycle at 100ms
const LENGTH = 20; // 2s fidget duration
const played: number[] = [];

const hashIdx = (n: number): number => {
  let x = Math.imul(n + 1, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) % FIDGETS.length;
};

export function fidgetAt(n: number): number {
  while (played.length <= n) {
    const i = played.length;
    const prev = played[i - 1];
    const picked = hashIdx(i);
    played.push(i > 0 && picked === prev ? (picked + 1) % FIDGETS.length : picked);
  }
  return played[n]!;
}

export const actions: Record<ActionName, ActionFn> = {
  // Thinking: strolls back and forth, star hairpin softly pulsing, tail swaying.
  walk: ({ t, dir }) => ({
    armMode: t % 6 < 3 ? 'waveL' : 'waveR',
    legMode: t % 4 < 2 ? 'stepA' : 'stepB',
    earMode: t % 12 < 2 ? 'twitch' : 'normal',
    tailPhase: Math.floor(t / 2) % 4,
    starGlow: t % 8 < 4,
    facing: dir,
  }),

  // Shell command: holographic terminal rune >_ floats beside her while sleeves tap.
  shell: ({ t, x, width }) => {
    const onRight = x + 36 < width;
    return {
      eyeMode: 'open',
      armMode: t % 4 < 2 ? 'typeL' : 'typeR',
      tailPhase: Math.floor(t / 3) % 4,
      fx: [{ kind: 'holoTerm', dx: onRight ? 25 : -13, dy: 6, phase: t % 6 }],
    };
  },

  // Reading files: holds an open glowing tome, flipping pages periodically.
  read: ({ t, x, width }) => {
    const onRight = x + 36 < width;
    return {
      eyeMode: onRight ? 'lookR' : 'lookL',
      armMode: onRight ? 'holdR' : 'holdL',
      earMode: 'twitch',
      fx: [{ kind: 'book', dx: onRight ? 23 : -11, dy: 11, phase: Math.floor(t / 4) % 3 }],
    };
  },

  // Web fetch: cosmic progress bar fills smoothly above her star clip.
  fetch: ({ t }) => ({
    eyeMode: 'wide',
    armMode: 'up',
    starGlow: true,
    fx: [{ kind: 'progressBar', dx: 2, dy: -6, phase: t % 16 }],
  }),

  // Searching: twirls a star-lensed magnifying glass with floating ? mark.
  search: ({ t, x, width }) => {
    const onRight = x + 36 < width;
    return {
      eyeMode: onRight ? 'lookR' : 'lookL',
      armMode: onRight ? 'holdR' : 'holdL',
      earMode: 'perk',
      fx: [
        { kind: 'lens', dx: onRight ? 24 : -10, dy: 7, phase: t % 6 },
        { kind: 'bubble', dx: onRight ? 27 : -7, dy: -1, text: '?', color: GOLD },
      ],
    };
  },

  // Editing files: swings her 4-pointed Gemini star wand casting cosmic pixel sparks!
  edit: ({ t, x, width }) => {
    const onRight = x + 36 < width;
    const hit = t % 4 < 2;
    return {
      eyeMode: hit ? 'happy' : 'open',
      armMode: hit ? 'wandDown' : 'wandUp',
      starGlow: true,
      tailPhase: t % 4,
      fx: [{ kind: 'wandSpark', dx: onRight ? 23 : -12, dy: hit ? 11 : 4, phase: hit ? 1 : 0 }],
    };
  },

  // Skill / workflow casting: raises both sleeves as twin violet-gold star comets orbit!
  skill: ({ t }) => ({
    eyeMode: 'happy',
    armMode: 'cheer',
    earMode: 'perk',
    starGlow: true,
    tailPhase: t % 4,
    fx: [{ kind: 'comets', dx: 12, dy: 6, phase: t % 12 }],
  }),

  // MCP tool call: left 4-point star hairpin pulses cyan cosmic waves!
  mcp: ({ t }) => ({
    eyeMode: 'wide',
    armMode: t % 2 === 0 ? 'typeL' : 'typeR',
    starGlow: true,
    fx: [{ kind: 'haloWaves', dx: 17, dy: 2, phase: Math.floor(t / 3) % 3 }],
  }),

  // Context compaction: gently squeezed between inward purple chevrons.
  compact: ({ t }) => ({
    eyeMode: 'dizzy',
    earMode: 'droop',
    dx: t % 2 === 0 ? 0 : 1,
    fx: [{ kind: 'squeeze', dx: 0, dy: 10, phase: t % 4 }],
  }),

  // Todo / steps checklist: glowing [x] holo checklist floats beside her.
  todo: ({ t, x, width }) => {
    const onRight = x + 36 < width;
    return {
      eyeMode: onRight ? 'lookR' : 'lookL',
      armMode: t % 4 < 2 ? 'typeL' : 'typeR',
      fx: [{ kind: 'checklist', dx: onRight ? 25 : -13, dy: 4, phase: Math.floor(t / 3) % 4 }],
    };
  },

  // Plan mode: unrolls glowing cyan star-chart blueprint & traces route.
  plan: ({ t, x, width }) => {
    const onRight = x + 36 < width;
    return {
      eyeMode: onRight ? 'lookR' : 'lookL',
      armMode: onRight ? 'holdR' : 'holdL',
      starGlow: true,
      fx: [{ kind: 'blueprint', dx: onRight ? 24 : -14, dy: 7, phase: Math.floor(t / 3) % 5 }],
    };
  },

  // Idle: calm breathing/blinking + gentle tail sway, playing one of 14 bespoke fidgets every 8s.
  idle: (ctx) => {
    const at = (ctx.t % GAP) - (GAP - LENGTH);
    const baseTail = Math.floor(ctx.t / 5) % 4;
    if (at < 0) {
      return {
        earMode: ctx.t % 67 < 2 ? 'twitch' : 'normal',
        tailPhase: baseTail,
      };
    }
    return FIDGETS[fidgetAt(Math.floor(ctx.t / GAP))]!(at, ctx);
  },

  // Sleep (after 10 min quiet): eyes closed, ears relaxed, gentle breathing & floating z Z.
  sleep: ({ t }) => ({
    eyeMode: 'blink',
    earMode: 'droop',
    legMode: 'crouch',
    dy: 2,
    tailPhase: 0,
    fx: [{ kind: 'sleepZ', dx: 18, dy: 0, phase: Math.floor(t / 5) % 4 }],
  }),

  // Typing along in the prompt: alternates sleeves & holds up the typed key.
  echo: ({ typed }) => {
    const keys = typed?.keys ?? 0;
    return {
      eyeMode: 'happy',
      armMode: keys % 2 === 0 ? 'typeL' : 'typeR',
      earMode: keys % 4 === 0 ? 'perk' : 'normal',
      tailPhase: keys % 4,
      starGlow: true,
      fx: [{ kind: 'bubble', dx: 7, dy: -1, text: typed?.char || '·', color: CYAN }],
    };
  },

  // Session reactions
  hello: ({ t }) => ({
    eyeMode: 'happy',
    armMode: t % 4 < 2 ? 'waveR' : 'up',
    earMode: 'perk',
    blush: true,
    starGlow: true,
    fx: [{ kind: 'bubble', dx: 21, dy: -2, text: 'hi!', color: GOLD }],
  }),

  celebrate: ({ t }) => {
    const pieces: FxItem[] = [-4, 0, 5, 19, 24, 28].map((col, i) => ({
      kind: 'confetti',
      dx: col,
      dy: (Math.floor(t / 2) + i * 3) % 24,
      phase: (t + i) % 4,
      color: HELPER_PALETTE[(i * 3) % HELPER_PALETTE.length],
    }));
    return {
      eyeMode: 'happy',
      armMode: 'cheer',
      legMode: t % 6 < 3 ? 'hop' : 'stand',
      earMode: 'perk',
      blush: true,
      starGlow: true,
      dy: t % 6 < 3 ? -3 : 0,
      fx: pieces,
    };
  },

  oops: ({ t }) => ({
    eyeMode: 'wide',
    earMode: 'droop',
    armMode: 'up',
    dx: t % 2 === 0 ? -1 : 1,
    fx: [{ kind: 'bubble', dx: 11, dy: -5, text: '!', color: '#ff5f5f' }],
  }),

  wake: () => ({
    eyeMode: 'wide',
    earMode: 'perk',
    armMode: 'up',
    starGlow: true,
    dy: -2,
    fx: [{ kind: 'bubble', dx: 11, dy: -5, text: '!', color: GOLD }],
  }),

  shrug: () => ({
    eyeMode: 'down',
    earMode: 'twitch',
    armMode: 'up',
    fx: [{ kind: 'bubble', dx: 10, dy: -4, text: '-.-', color: '#a9b1d6' }],
  }),

  sad: ({ t }) => ({
    eyeMode: 'down',
    earMode: 'droop',
    tailPhase: 0,
    dy: 1,
    fx: [{ kind: 'tear', dx: 8, dy: 12 + (t % 4), color: CYAN }],
  }),

  // Click poke reactions
  pet: ({ t }) => ({
    eyeMode: 'happy',
    earMode: 'perk',
    blush: true,
    starGlow: true,
    tailPhase: t % 4,
    fx: [{ kind: 'heart', dx: 10, dy: t % 4 < 2 ? -2 : -4, color: MAGENTA }],
  }),

  spin: ({ t }) => ({
    eyeMode: 'dizzy',
    armMode: t % 2 === 0 ? 'waveL' : 'waveR',
    facing: t % 4 < 2 ? 1 : -1,
    tailPhase: t % 4,
    fx: [{ kind: 'star', dx: 11, dy: -3, color: GOLD }],
  }),

  shoo: ({ t }) => ({
    eyeMode: 'wide',
    armMode: t % 4 < 2 ? 'waveL' : 'waveR',
    earMode: 'perk',
    fx: [{ kind: 'bubble', dx: 11, dy: -5, text: '!?', color: '#ff5f5f' }],
  }),

  peek: () => ({
    eyeMode: 'wide',
    earMode: 'perk',
    blush: true,
    fx: [{ kind: 'bubble', dx: 10, dy: -4, text: 'o.o', color: CYAN }],
  }),

  bonk: ({ t }) => ({
    eyeMode: 'dizzy',
    earMode: 'droop',
    armMode: 'wandDown',
    dy: 2,
    fx: [{ kind: 'star', dx: 11, dy: -4, phase: t % 2, color: GOLD }],
  }),

  highfive: () => ({
    eyeMode: 'happy',
    armMode: 'cheer',
    earMode: 'perk',
    blush: true,
    starGlow: true,
    dy: -2,
    fx: [{ kind: 'star', dx: 22, dy: 2, color: GOLD }],
  }),

  found: () => ({
    eyeMode: 'happy',
    armMode: 'holdR',
    earMode: 'perk',
    starGlow: true,
    fx: [{ kind: 'bubble', dx: 22, dy: -2, text: '!', color: GOLD }],
  }),

  poof: ({ t }) => ({
    eyeMode: 'dizzy',
    earMode: 'droop',
    fx: [{ kind: 'smoke', dx: 12, dy: 0, phase: t % 4, color: LAVENDER }],
  }),

  zap: ({ t }) => ({
    eyeMode: 'dizzy',
    earMode: 'perk',
    starGlow: true,
    dx: t % 2 === 0 ? -1 : 1,
    fx: [{ kind: 'static', dx: 17, dy: 1, phase: t % 3, color: CYAN }],
  }),
};
