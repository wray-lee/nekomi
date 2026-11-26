import type { AgyHookPayload } from './src/types';

const PORT = Number(process.env.NEKOMI_PORT ?? 47821);
const ENDPOINT = `http://127.0.0.1:${PORT}/hook`;

async function main(): Promise<void> {
  let raw = '';
  try {
    raw = await Bun.stdin.text();
  } catch {
    return;
  }

  let payload: AgyHookPayload = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw) as AgyHookPayload;
    } catch {
      payload = {};
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // Ignore when nekomi wrapper/TUI is not running.
  } finally {
    clearTimeout(timer);
  }
}

try {
  await main();
} finally {
  console.log('{}');
}
