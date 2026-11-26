import { actions } from './actions';
import { pickHelperColor } from './palette';
import type {
  ActionName,
  Activity,
  AgyHookPayload,
  EventKind,
  Helper,
  Pose,
  RecentActivity,
  RenderHelper,
  RenderSnapshot,
  Scene,
} from './types';

export const SPRITE_W = 16;
export const STAGE_W = 80;
export const FX_MARGIN = 6;
export const HOLD_TICKS = 15; // 1.5s minimum action hold
export const TYPING_TICKS = 15; // 1.5s typing echo hold
export const SLEEP_AFTER = 6000; // 10 min idle before sleeping

const EVENT_TICKS: Record<EventKind, number> = {
  celebrate: 20,
  oops: 10,
  wake: 8,
  hello: 16,
  shrug: 12,
  sad: 16,
  pet: 12,
  spin: 10,
  shoo: 10,
  peek: 10,
  bonk: 10,
  highfive: 12,
  found: 12,
  poof: 10,
  zap: 10,
};

const CLICK_MAP: Partial<Record<ActionName, EventKind>> = {
  sleep: 'wake',
  idle: 'pet',
  echo: 'pet',
  walk: 'spin',
  shell: 'shoo',
  read: 'peek',
  fetch: 'peek',
  search: 'found',
  edit: 'bonk',
  skill: 'poof',
  mcp: 'zap',
  compact: 'shoo',
  todo: 'peek',
  plan: 'peek',
  celebrate: 'highfive',
};

export function activityOfAgyTool(toolName: string): Activity {
  const t = toolName.toLowerCase();
  if (/^(run_command|manage_task)$/.test(t)) return 'shell';
  if (/^(read_file|view_file|list_dir|find_by_name|grep_search)$/.test(t)) {
    return t === 'grep_search' || t === 'find_by_name' ? 'search' : 'read';
  }
  if (/^(search_web)$/.test(t)) return 'search';
  if (/^(browser_|fetch|download)/.test(t)) return 'fetch';
  if (/^(edit_file|write_file|replace_file_content|multi_replace_file_content)$/.test(t)) return 'edit';
  if (/^(run_workflow|skill)/.test(t)) return 'skill';
  if (/^(call_mcp_tool|mcp_)/.test(t)) return 'mcp';
  if (/^(update_steps|ask_question)$/.test(t)) return 'todo';
  if (/^(plan|write_to_file.*plan)/.test(t)) return 'plan';
  return 'think';
}

export function lineUpHelpers(helpers: Helper[]): Helper[] {
  const ids = new Set(helpers.map((h) => h.id));
  const out: Helper[] = [];
  const add = (h: Helper) => {
    out.push(h);
    for (const c of helpers) {
      if (c.parent === h.id) add(c);
    }
  };
  for (const h of helpers) {
    if (!h.parent || !ids.has(h.parent)) add(h);
  }
  return out;
}

export class NekomiEngine {
  scene: Scene;
  isWorking = false;
  runningTools: Array<{ id: string; name: string; activity: Activity; startedAt: number }> = [];
  recent: RecentActivity | null = null;
  helpers = new Map<string, Helper>();
  compactingUntil = 0;
  lastTool?: string;
  private lastTokenTotal = 0;

  constructor(initialX = Math.floor((STAGE_W - SPRITE_W) / 2)) {
    this.scene = { t: 0, x: initialX, dir: -1, idle: 0, event: null, typing: null };
  }

  isAsleep(activity: Activity | null): boolean {
    return activity === null && !this.scene.typing && this.scene.idle >= SLEEP_AFTER;
  }

  triggerEvent(kind: EventKind): void {
    this.scene = {
      ...this.scene,
      idle: 0,
      dir: kind === 'spin' ? (this.scene.dir === 1 ? -1 : 1) : this.scene.dir,
      event: { kind, until: this.scene.t + EVENT_TICKS[kind] },
    };
  }

  typed(text: string): void {
    if (!text) return;
    if (this.isAsleep(this.currentActivity())) {
      this.triggerEvent('wake');
    }
    const ch = [...text].pop() ?? '';
    const keys = (this.scene.typing?.keys ?? 0) + 1;
    this.scene = {
      ...this.scene,
      idle: 0,
      typing: { keys, char: ch, until: this.scene.t + TYPING_TICKS },
    };
  }

  poke(): EventKind | null {
    const act = this.currentAction();
    const kind = CLICK_MAP[act];
    if (!kind) return null;
    this.triggerEvent(kind);
    return kind;
  }

  currentActivity(): Activity | null {
    if (this.scene.t < this.compactingUntil) return 'compact';
    const latest = this.runningTools[this.runningTools.length - 1];
    if (latest) return latest.activity;
    if (this.recent && this.scene.t < this.recent.until) return this.recent.activity;
    return this.isWorking ? 'think' : null;
  }

  currentAction(): ActionName {
    if (this.scene.event && this.scene.t < this.scene.event.until) return this.scene.event.kind;
    if (this.scene.typing && this.scene.t < this.scene.typing.until) return 'echo';
    const act = this.currentActivity();
    if (act) return act === 'think' ? 'walk' : act;
    return this.isAsleep(act) ? 'sleep' : 'idle';
  }

  tick(cols = STAGE_W): void {
    const t = this.scene.t + 1;
    const act = this.currentActivity();
    const event = this.scene.event && t < this.scene.event.until ? this.scene.event : null;
    const typing = this.scene.typing && t < this.scene.typing.until ? this.scene.typing : null;
    let { x, dir } = this.scene;
    const minX = 4;
    const maxX = Math.max(minX, cols - SPRITE_W - 4);
    x = Math.max(minX, Math.min(maxX, x));

    if (act === 'think' && !event && !typing && t % 2 === 0) {
      if (x + dir < minX || x + dir > maxX) dir = dir === 1 ? -1 : 1;
      x = Math.max(minX, Math.min(maxX, x + dir));
    }

    const isQuiet = act === null && !event && !typing;
    this.scene = {
      t,
      x,
      dir,
      idle: isQuiet ? this.scene.idle + 1 : 0,
      event,
      typing,
    };
  }

  handleHook(payload: AgyHookPayload): void {
    const ev = payload.hookEventName ?? '';

    if (ev === 'SessionStart') {
      this.isWorking = false;
      this.runningTools = [];
      this.helpers.clear();
      this.triggerEvent('hello');
      return;
    }

    if (ev === 'PreInvocation') {
      if (this.isAsleep(this.currentActivity())) {
        this.triggerEvent('wake');
      }
      this.isWorking = true;
      this.scene = { ...this.scene, idle: 0 };
      return;
    }

    if (ev === 'PreToolUse') {
      this.isWorking = true;
      const name = payload.toolCall?.name ?? 'unknown';
      const id = payload.toolCall?.id ?? `tool_${this.scene.t}_${Math.random()}`;
      const activity = activityOfAgyTool(name);
      this.lastTool = name;
      this.runningTools.push({ id, name, activity, startedAt: Date.now() });
      this.recent = { activity, until: this.scene.t + HOLD_TICKS };
      this.spawnHelpersForTool(name, id, payload.toolCall?.args);
      return;
    }

    if (ev === 'PostToolUse') {
      const id = payload.toolCall?.id ?? `post_${this.scene.t}`;
      const name = payload.toolCall?.name ?? '';
      const activity = activityOfAgyTool(name);
      this.lastTool = name;

      if (payload.toolCall?.id) {
        const idx = this.runningTools.findIndex((r) => r.id === payload.toolCall!.id);
        if (idx >= 0) this.runningTools.splice(idx, 1);
      } else if (this.runningTools.length) {
        this.runningTools.pop();
      }

      // Hold the completed tool's animation for HOLD_TICKS even when PreToolUse isn't wired.
      if (name) {
        this.recent = { activity, until: this.scene.t + HOLD_TICKS };
        this.spawnHelpersForTool(name, id, payload.toolCall?.args);
      }
      if (payload.error) {
        this.triggerEvent('oops');
      }
      return;
    }

    if (ev === 'PostInvocation') {
      return;
    }

    if (ev === 'Stop') {
      this.isWorking = false;
      this.runningTools = [];
      if (payload.fullyIdle) {
        this.helpers.clear();
      }
      const reason = payload.terminationReason ?? 'NO_TOOL_CALL';
      if (reason === 'USER_CANCELED') {
        this.triggerEvent('shrug');
      } else if (reason === 'ERROR' || reason.startsWith('MAX_')) {
        this.triggerEvent('sad');
      } else {
        this.triggerEvent('celebrate');
      }
    }
  }

  private spawnHelpersForTool(name: string, id: string, args?: Record<string, unknown>): void {
    if (name === 'invoke_subagent') {
      const role = String(args?.Role ?? args?.TypeName ?? 'subagent');
      this.addHelper(`sub:${role}:${id}`, { role, depth: 1, isWorkflow: false });
    } else if (name === 'run_workflow') {
      for (let i = 0; i < 3; i++) {
        this.addHelper(`wf:${id}:${i}`, { role: `workflow-${i + 1}`, depth: 1, isWorkflow: true });
      }
    } else if (name === 'swarm' && args?.action === 'add') {
      const sName = String(args?.name ?? 'worker');
      this.addHelper(`swarm:${sName}`, { role: sName, depth: 1, isWorkflow: true });
    } else if (name === 'manage_subagents' && args?.Action === 'kill_all') {
      this.helpers.clear();
    }
  }

  syncSubagents(active: Array<{ id: string; role?: string; parent?: string; depth?: number; isWorkflow?: boolean }>): void {
    const keep = new Set(active.map((a) => a.id));
    for (const id of [...this.helpers.keys()]) {
      if (!keep.has(id) && !id.startsWith('wf:')) {
        this.helpers.delete(id);
      }
    }
    for (const item of active) {
      if (!this.helpers.has(item.id)) {
        this.addHelper(item.id, {
          role: item.role,
          parent: item.parent,
          depth: item.depth ?? 1,
          isWorkflow: item.isWorkflow,
        });
      }
    }
  }

  reportTokenCount(totalTokens: number): void {
    if (this.lastTokenTotal > 40000 && totalTokens > 0 && totalTokens < this.lastTokenTotal * 0.55) {
      this.compactingUntil = this.scene.t + 20;
    }
    if (totalTokens > 0) this.lastTokenTotal = totalTokens;
  }

  addHelper(id: string, opts: { role?: string; parent?: string; depth?: number; isWorkflow?: boolean }): void {
    if (this.helpers.has(id)) return;
    const taken = [...this.helpers.values()].map((h) => h.color);
    this.helpers.set(id, {
      id,
      role: opts.role,
      parent: opts.parent,
      depth: opts.depth ?? 1,
      color: pickHelperColor(taken),
      isWorkflow: opts.isWorkflow,
    });
  }

  removeHelper(id: string): void {
    this.helpers.delete(id);
  }

  snapshot(cols = STAGE_W): RenderSnapshot {
    const act = this.currentActivity();
    const action = this.currentAction();
    const blink = this.scene.t % 53 < 2;
    const clampedX = Math.max(4, Math.min(Math.max(4, cols - SPRITE_W - 4), this.scene.x));
    const rawPose = actions[action]({
      t: this.scene.t,
      x: clampedX,
      width: cols,
      dir: this.scene.dir,
      blink,
      typed: this.scene.typing ? { keys: this.scene.typing.keys, char: this.scene.typing.char } : null,
    });

    const pose: RenderSnapshot['pose'] = {
      eyeMode: rawPose.eyeMode ?? (blink ? 'blink' : 'open'),
      armMode: rawPose.armMode ?? 'down',
      legMode: rawPose.legMode ?? 'stand',
      earMode: rawPose.earMode ?? 'normal',
      tailPhase: rawPose.tailPhase ?? (Math.floor(this.scene.t / 5) % 4),
      starGlow: rawPose.starGlow ?? false,
      blush: rawPose.blush ?? false,
      dx: rawPose.dx ?? 0,
      dy: rawPose.dy ?? 0,
      facing: rawPose.facing ?? this.scene.dir,
      fx: rawPose.fx ?? [],
    };

    const lined = lineUpHelpers([...this.helpers.values()]);
    const toLeft = clampedX + SPRITE_W / 2 >= cols / 2;
    let cursor = toLeft ? clampedX - FX_MARGIN : clampedX + SPRITE_W + FX_MARGIN;
    const helpersOut: RenderHelper[] = [];
    const hidden: Helper[] = [];
    let counted = 0;

    for (const [i, h] of lined.entries()) {
      const w = h.depth > 2 ? 2 : h.depth > 1 ? 5 : 8;
      const col = toLeft ? cursor - w : cursor;
      if (h.depth <= 2 && counted >= 8) {
        hidden.push(h);
        continue;
      }
      if (col < 1 || col + w > cols - 1) {
        hidden.push(h);
        continue;
      }
      if (h.depth <= 2) counted++;
      helpersOut.push({
        id: h.id,
        role: h.role,
        depth: h.depth,
        color: h.color,
        isWorkflow: !!h.isWorkflow,
        hopDy: (this.scene.t + i * 4) % 12 < 2 ? -1 : 0,
        blink: (this.scene.t + i * 7) % 53 < 2,
        x: col,
      });
      cursor = toLeft ? col - 2 : col + w + 2;
    }

    return {
      t: this.scene.t,
      action,
      activity: act,
      isWorking: this.isWorking,
      isAsleep: this.isAsleep(act),
      x: clampedX,
      dir: this.scene.dir,
      pose,
      helpers: helpersOut,
      overflowHelpers: {
        plain: hidden.filter((h) => !h.isWorkflow).length,
        workflow: hidden.filter((h) => !!h.isWorkflow).length,
        colors: hidden.slice(0, 8).map((h) => h.color),
      },
      lastTool: this.lastTool,
    };
  }
}
