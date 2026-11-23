import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BetfairSession } from '../../src/integrations/betfair/auth.js';
import { BetfairStream } from '../../src/integrations/betfair/stream.js';
import type { MarketSnapshot } from '../../src/integrations/betfair/types.js';

describe('Betfair Exchange Stream cache', () => {
  it('builds an image, merges deltas, ignores heartbeats and tracks status transitions', () => {
    const stream = new BetfairStream({ appKey: 'k' } as BetfairSession, 'stream.example');
    const snaps: MarketSnapshot[] = [];
    stream.onSnapshot((s) => snaps.push(s));
    const lines = readFileSync(join(import.meta.dirname, '../fixtures/betfair/streamMessages.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    for (const msg of lines.filter((m) => m.op === 'mcm')) (stream as unknown as { handleMcm(m: unknown): void }).handleMcm(msg);

    expect(snaps).toHaveLength(4); // image + delta + suspend + close (heartbeat emits nothing)
    const [image, delta, suspended, closed] = snaps;
    expect(image.runners.find((r) => r.selectionId === 414464)!.back).toEqual([{ price: 1.85, size: 5000 }, { price: 1.84, size: 2500 }, { price: 1.83, size: 7500 }]);
    const r = delta.runners.find((x) => x.selectionId === 414464)!;
    expect(r.back).toEqual([{ price: 1.84, size: 6000 }, { price: 1.84, size: 2500 }]); // level 2 removed (size 0)
    expect(r.lastPriceTraded).toBe(1.84);
    expect(r.lay).toHaveLength(3); // untouched side retained
    expect(suspended.status).toBe('SUSPENDED');
    expect(suspended.inPlay).toBe(true);
    expect(closed.status).toBe('CLOSED');
    expect(closed.runners.find((x) => x.selectionId === 414464)!.status).toBe('WINNER');
  });
});
