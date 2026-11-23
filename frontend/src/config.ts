/** Public, non-secret runtime config. Betfair credentials never reach the browser. */
const origin = typeof window !== 'undefined' ? window.location : undefined;

export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? '/api',
  wsUrl: import.meta.env.VITE_WS_URL ?? (origin ? `${origin.protocol === 'https:' ? 'wss' : 'ws'}://${origin.host}/ws` : ''),
  brand: import.meta.env.VITE_BRAND_NAME ?? 'BetX',
  currency: 'INR',
  minStake: 10,
};
