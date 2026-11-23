/** Row shapes returned by mysql2 (DECIMAL → string, DATETIME → Date). */
export interface UserRow {
  id: number;
  uuid: string;
  email: string;
  username: string;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: Date | null;
  country_code: string | null;
  currency: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'SELF_EXCLUDED';
  email_verified_at: Date | null;
  kyc_status: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  age_verified: number;
  terms_version: string | null;
  terms_accepted_at: Date | null;
  totp_secret_enc: string | null;
  totp_enabled: number;
  failed_logins: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

export interface WalletRow {
  id: number;
  user_id: number;
  currency: string;
  balance: string;
  exposure: string;
  version: number;
}

export interface AdminRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: AdminRole;
  is_active: number;
  totp_secret_enc: string | null;
  totp_enabled: number;
  failed_logins: number;
  locked_until: Date | null;
}

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'RISK_MANAGER' | 'SUPPORT';
export type Role = AdminRole | 'USER';

export interface BetItemRow {
  id: number;
  uuid: string;
  bet_id: number;
  user_id: number;
  market_id: number;
  selection_id: number;
  side: 'BACK' | 'LAY';
  requested_price: string;
  stake: string;
  liability: string;
  size_matched: string;
  avg_price_matched: string | null;
  size_cancelled: string;
  size_lapsed: string;
  status: 'PENDING' | 'UNMATCHED' | 'PARTIALLY_MATCHED' | 'MATCHED' | 'CANCELLED' | 'LAPSED' | 'FAILED' | 'SETTLED' | 'VOIDED';
  result: 'WIN' | 'LOSS' | 'VOID' | 'PARTIAL' | null;
  profit_loss: string | null;
  commission: string;
  failure_code: string | null;
  placed_at: Date;
  matched_at: Date | null;
  settled_at: Date | null;
}
