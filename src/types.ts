export type EyeMode = 'open' | 'blink' | 'happy' | 'lookL' | 'lookR' | 'down' | 'wide' | 'dizzy';
export type ArmMode =
  | 'down'
  | 'up'
  | 'waveL'
  | 'waveR'
  | 'typeL'
  | 'typeR'
  | 'holdR'
  | 'holdL'
  | 'wandUp'
  | 'wandDown'
  | 'cheer';
export type LegMode = 'stand' | 'stepA' | 'stepB' | 'crouch' | 'hop';
export type EarMode = 'normal' | 'twitch' | 'perk' | 'droop';

export type Activity =
  | 'think'
  | 'shell'
  | 'read'
  | 'fetch'
  | 'search'
  | 'edit'
  | 'skill'
  | 'mcp'
  | 'compact'
  | 'todo'
  | 'plan';

export type EventKind =
  | 'celebrate'
  | 'oops'
  | 'wake'
  | 'hello'
  | 'shrug'
  | 'sad'
  | 'pet'
  | 'spin'
  | 'shoo'
  | 'peek'
  | 'bonk'
  | 'highfive'
  | 'found'
  | 'poof'
  | 'zap';

export type ActionName =
  | 'walk'
  | 'shell'
  | 'read'
  | 'fetch'
  | 'search'
  | 'edit'
  | 'skill'
  | 'mcp'
  | 'compact'
  | 'todo'
  | 'plan'
  | 'idle'
  | 'sleep'
  | 'echo'
  | EventKind;

export type FxKind =
  | 'confetti'
  | 'star'
  | 'wandSpark'
  | 'holoTerm'
  | 'book'
  | 'lens'
  | 'progressBar'
  | 'comets'
  | 'haloWaves'
  | 'checklist'
  | 'blueprint'
  | 'squeeze'
  | 'bubble'
  | 'sleepZ'
  | 'heart'
  | 'tear'
  | 'smoke'
  | 'static'
  | 'musicNote';

export interface FxItem {
  kind: FxKind;
  /** Offset relative to sprite origin in logical pixel-art units (24x28 grid). */
  dx: number;
  dy: number;
  phase?: number;
  color?: string;
  text?: string;
}

export interface Pose {
  eyeMode?: EyeMode;
  armMode?: ArmMode;
  legMode?: LegMode;
  earMode?: EarMode;
  tailPhase?: number;
  starGlow?: boolean;
  blush?: boolean;
  dx?: number;
  dy?: number;
  facing?: 1 | -1;
  fx?: FxItem[];
}

export interface ActionCtx {
  t: number;
  x: number;
  width: number;
  dir: 1 | -1;
  blink: boolean;
  typed: { keys: number; char: string } | null;
}

export type ActionFn = (ctx: ActionCtx) => Pose;

export interface Helper {
  id: string;
  role?: string;
  parent?: string;
  depth: number;
  color: string;
  isWorkflow?: boolean;
}

export interface Scene {
  t: number;
  x: number;
  dir: 1 | -1;
  idle: number;
  event: { kind: EventKind; until: number } | null;
  typing: { keys: number; char: string; until: number } | null;
}

export interface RecentActivity {
  activity: Activity;
  until: number;
}

export interface RenderHelper {
  id: string;
  role?: string;
  depth: number;
  color: string;
  isWorkflow: boolean;
  hopDy: number;
  blink: boolean;
  x: number;
}

export interface RenderSnapshot {
  t: number;
  action: ActionName;
  activity: Activity | null;
  isWorking: boolean;
  isAsleep: boolean;
  x: number;
  dir: 1 | -1;
  pose: Required<Omit<Pose, 'fx'>> & { fx: FxItem[] };
  helpers: RenderHelper[];
  overflowHelpers: { plain: number; workflow: number; colors: string[] };
  lastTool?: string;
}

export interface AgyHookPayload {
  hookEventName?: string;
  conversationId?: string;
  transcriptPath?: string;
  cwd?: string;
  modelName?: string;
  lastUserInput?: string;
  invocationNum?: number;
  executionNum?: number;
  terminationReason?: string;
  fullyIdle?: boolean;
  error?: string;
  stepIdx?: number;
  toolCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
  _nekomi?: {
    lsAddress?: string;
    csrfToken?: string;
  };
}
