import { execute, query } from '../config/db.js';
import { env } from '../config/env.js';

export interface RiskDefaults { minStake: number; maxStake: number; maxExposure: number; maxOdds: number }
export interface RiskAlertConfig { largeStakeMultiplier: number; rapidBetsPerMinute: number; failedBetsPerHour: number }
export interface ComplianceSettings { requireKycForWithdrawal: boolean; limitIncreaseCooldownHours: number }

interface Settings {
  'risk.defaults': RiskDefaults;
  'risk.alerts': RiskAlertConfig;
  commission: { rate: number };
  compliance: ComplianceSettings;
}

const DEFAULTS: Settings = {
  'risk.defaults': { minStake: env.MIN_STAKE, maxStake: 100000, maxExposure: 500000, maxOdds: 1000 },
  'risk.alerts': { largeStakeMultiplier: 10, rapidBetsPerMinute: 20, failedBetsPerHour: 15 },
  commission: { rate: env.COMMISSION_RATE },
  compliance: { requireKycForWithdrawal: true, limitIncreaseCooldownHours: 24 },
};

let cache: { at: number; values: Settings } | null = null;
const TTL = 30_000;

/** DB-backed operational settings (editable by admins) with a short cache. */
export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL) return cache.values;
  const rows = await query<{ setting_key: keyof Settings; setting_value: unknown }>('SELECT setting_key, setting_value FROM system_settings');
  const values = structuredClone(DEFAULTS);
  for (const r of rows) {
    if (r.setting_key in values) {
      const v = typeof r.setting_value === 'string' ? JSON.parse(r.setting_value) : r.setting_value;
      Object.assign(values[r.setting_key] as object, v);
    }
  }
  cache = { at: Date.now(), values };
  return values;
}

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  return (await getSettings())[key];
}

export async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K], adminId: number) {
  await execute(
    'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
    [key, JSON.stringify(value), adminId],
  );
  cache = null;
}

export const SETTING_KEYS = Object.keys(DEFAULTS) as Array<keyof Settings>;
