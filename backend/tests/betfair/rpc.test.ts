import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BetfairSession } from '../../src/integrations/betfair/auth.js';
import { BetfairError, toAppError } from '../../src/integrations/betfair/errors.js';
import { BetfairRpc } from '../../src/integrations/betfair/http.js';
import { bookToSnapshot, marketBook } from '../../src/integrations/betfair/marketBook.js';
import { order } from '../../src/integrations/betfair/order.js';

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/betfair', name), 'utf8'));

function fakeSession() {
  let n = 0;
  return {
    appKey: 'APPKEY',
    getToken: vi.fn(async () => `token-${++n}`),
    invalidate: vi.fn(),
    isValid: () => true,
  } as unknown as BetfairSession & { getToken: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> };
}

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Betfair JSON-RPC layer (mocked HTTP)', () => {
  it('maps listMarketBook into UI snapshots', async () => {
    const fetchMock = vi.fn(async () => respond(fixture('listMarketBook.json')));
    vi.stubGlobal('fetch', fetchMock);
    const rpc = new BetfairRpc(fakeSession(), 'https://api.example', 1000);
    const [book] = await marketBook(rpc).listMarketBook(['1.234567890']);
    const snap = bookToSnapshot(book);
    expect(snap.runners[0].back[0]).toEqual({ price: 1.85, size: 5000 });
    expect(snap.runners[0].lay[0]).toEqual({ price: 1.86, size: 3500 });
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.method).toBe('SportsAPING/v1.0/listMarketBook');
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'X-Application': 'APPKEY' });
  });

  it('re-authenticates once on INVALID_SESSION_INFORMATION and retries', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(fixture('invalidSession.json'))).mockResolvedValueOnce(respond(fixture('listMarketBook.json')));
    vi.stubGlobal('fetch', fetchMock);
    const session = fakeSession();
    const rpc = new BetfairRpc(session, 'https://api.example', 1000);
    await marketBook(rpc).listMarketBook(['1.234567890']);
    expect(session.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns instruction-level failures from placeOrders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(fixture('placeOrders.marketSuspended.json'))));
    const rpc = new BetfairRpc(fakeSession(), 'https://api.example', 1000);
    const r = await order(rpc).placeOrders('1.234567890', [], 'ref');
    expect(r.status).toBe('FAILURE');
    expect(r.errorCode).toBe('MARKET_SUSPENDED');
  });

  it('reports a retryable timeout without leaking details to users', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))));
    const observer = vi.fn();
    const rpc = new BetfairRpc(fakeSession(), 'https://api.example', 20, observer);
    const err = await marketBook(rpc).listMarketBook(['1.1']).catch((e) => e);
    expect(err).toBeInstanceOf(BetfairError);
    expect(err.retryable).toBe(true);
    expect(observer).toHaveBeenCalledWith(expect.objectContaining({ status: 'TIMEOUT' }));
    const safe = toAppError(err);
    expect(safe.code).toBe('EXCHANGE_TIMEOUT');
    expect(safe.message).not.toMatch(/api\.example|token/i);
  });

  it('treats HTTP 5xx as service unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 503 })));
    const rpc = new BetfairRpc(fakeSession(), 'https://api.example', 1000);
    const err = await marketBook(rpc).listMarketBook(['1.1']).catch((e) => e);
    expect(toAppError(err).code).toBe('EXCHANGE_UNAVAILABLE');
  });
});
