import axios from 'axios';
import { config } from '../../config';

export interface ExchangeStatus { mode: 'mock' | 'live'; sessionValid: boolean; streamConnected: boolean }

/** Exchange connectivity as reported by our backend (no Betfair credentials in the browser). */
export async function getExchangeStatus(): Promise<ExchangeStatus | null> {
  try {
    const base = config.apiUrl.replace(/\/api\/?$/, '');
    const r = await axios.get(`${base}/health`, { timeout: 5000 });
    return r.data.checks.betfair as ExchangeStatus;
  } catch {
    return null;
  }
}
