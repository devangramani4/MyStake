-- Core schema: users, auth, wallet & ledger, catalogue, betting, settlement,
-- payments, admin, compliance, logging. Target: MySQL 8.0+ (InnoDB, utf8mb4).
-- All money columns are DECIMAL(18,2); odds are DECIMAL(8,2).

-- ───────────────────────── Users & authentication ─────────────────────────
CREATE TABLE users (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              CHAR(36)      NOT NULL,
  email             VARCHAR(255)  NOT NULL,
  username          VARCHAR(32)   NOT NULL,
  password_hash     VARCHAR(255)  NOT NULL,
  first_name        VARCHAR(100)  NULL,
  last_name         VARCHAR(100)  NULL,
  date_of_birth     DATE          NULL,
  country_code      CHAR(2)       NULL,
  currency          CHAR(3)       NOT NULL DEFAULT 'INR',
  status            ENUM('ACTIVE','SUSPENDED','CLOSED','SELF_EXCLUDED') NOT NULL DEFAULT 'ACTIVE',
  email_verified_at DATETIME(3)   NULL,
  kyc_status        ENUM('NOT_STARTED','PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'NOT_STARTED',
  age_verified      TINYINT(1)    NOT NULL DEFAULT 0,
  terms_version     VARCHAR(20)   NULL,
  terms_accepted_at DATETIME(3)   NULL,
  totp_secret_enc   VARCHAR(255)  NULL,
  totp_enabled      TINYINT(1)    NOT NULL DEFAULT 0,
  failed_logins     INT UNSIGNED  NOT NULL DEFAULT 0,
  locked_until      DATETIME(3)   NULL,
  last_login_at     DATETIME(3)   NULL,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_uuid (uuid),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_status (status),
  KEY idx_users_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refresh-token sessions. Only SHA-256 hashes of tokens are stored.
-- `family_id` groups rotated tokens; reuse of a revoked token revokes the family.
CREATE TABLE user_sessions (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  family_id          CHAR(36)     NOT NULL,
  refresh_token_hash CHAR(64)     NOT NULL,
  user_agent         VARCHAR(255) NULL,
  ip_address         VARCHAR(45)  NULL,
  device_label       VARCHAR(100) NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at         DATETIME(3)  NOT NULL,
  revoked_at         DATETIME(3)  NULL,
  revoked_reason     VARCHAR(50)  NULL,
  replaced_by_id     BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_sessions_token (refresh_token_hash),
  KEY idx_sessions_user (user_id, revoked_at),
  KEY idx_sessions_family (family_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_tokens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  purpose     ENUM('EMAIL_VERIFY','PASSWORD_RESET') NOT NULL,
  token_hash  CHAR(64)    NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_auth_tokens_hash (token_hash),
  KEY idx_auth_tokens_user (user_id, purpose),
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Wallet & ledger ─────────────────────────
-- balance  = funds available to bet/withdraw
-- exposure = funds locked as liability for open bets
-- total    = balance + exposure
CREATE TABLE user_wallets (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  currency    CHAR(3)       NOT NULL,
  balance     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  exposure    DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  version     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wallet_user (user_id),
  CONSTRAINT chk_wallet_balance  CHECK (balance  >= 0),
  CONSTRAINT chk_wallet_exposure CHECK (exposure >= 0),
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only ledger. `amount` is the change to `balance`,
-- `exposure_change` the change to `exposure`. Rows are never updated.
CREATE TABLE wallet_transactions (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid             CHAR(36)      NOT NULL,
  wallet_id        BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  type             ENUM('DEPOSIT','WITHDRAWAL','BET','WIN','LOSS','REFUND','COMMISSION','ADJUSTMENT') NOT NULL,
  amount           DECIMAL(18,2) NOT NULL,
  exposure_change  DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  balance_after    DECIMAL(18,2) NOT NULL,
  exposure_after   DECIMAL(18,2) NOT NULL,
  reference_type   VARCHAR(30)   NULL,
  reference_id     VARCHAR(64)   NULL,
  idempotency_key  VARCHAR(100)  NOT NULL,
  description      VARCHAR(255)  NULL,
  created_by_admin BIGINT UNSIGNED NULL,
  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wtx_uuid (uuid),
  UNIQUE KEY uq_wtx_idem (idempotency_key),
  KEY idx_wtx_user_time (user_id, created_at),
  KEY idx_wtx_type_time (type, created_at),
  KEY idx_wtx_reference (reference_type, reference_id),
  CONSTRAINT fk_wtx_wallet FOREIGN KEY (wallet_id) REFERENCES user_wallets(id),
  CONSTRAINT fk_wtx_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Sports catalogue ─────────────────────────
-- Synchronised from Betfair navigation / listMarketCatalogue.
CREATE TABLE sports (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  betfair_id     VARCHAR(20)  NOT NULL,
  name           VARCHAR(100) NOT NULL,
  slug           VARCHAR(100) NOT NULL,
  icon           VARCHAR(50)  NULL,
  display_order  INT          NOT NULL DEFAULT 100,
  is_enabled     TINYINT(1)   NOT NULL DEFAULT 1,
  market_count   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sports_betfair (betfair_id),
  UNIQUE KEY uq_sports_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE competitions (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  betfair_id   VARCHAR(20)  NOT NULL,
  sport_id     INT UNSIGNED NOT NULL,
  name         VARCHAR(200) NOT NULL,
  region       VARCHAR(20)  NULL,
  is_enabled   TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_comp_betfair (betfair_id),
  KEY idx_comp_sport (sport_id),
  CONSTRAINT fk_comp_sport FOREIGN KEY (sport_id) REFERENCES sports(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE events (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  betfair_id      VARCHAR(20)  NOT NULL,
  sport_id        INT UNSIGNED NOT NULL,
  competition_id  INT UNSIGNED NULL,
  name            VARCHAR(255) NOT NULL,
  country_code    VARCHAR(4)   NULL,
  timezone        VARCHAR(50)  NULL,
  venue           VARCHAR(255) NULL,
  open_date       DATETIME(3)  NOT NULL,
  status          ENUM('UPCOMING','IN_PLAY','CLOSED','SUSPENDED') NOT NULL DEFAULT 'UPCOMING',
  is_enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  is_featured     TINYINT(1)   NOT NULL DEFAULT 0,
  has_stream      TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_events_betfair (betfair_id),
  KEY idx_events_sport_date (sport_id, status, open_date),
  KEY idx_events_comp (competition_id),
  KEY idx_events_status_date (status, open_date),
  CONSTRAINT fk_events_sport FOREIGN KEY (sport_id) REFERENCES sports(id),
  CONSTRAINT fk_events_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE markets (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  betfair_id        VARCHAR(20)  NOT NULL,
  event_id          BIGINT UNSIGNED NOT NULL,
  name              VARCHAR(255) NOT NULL,
  market_type       VARCHAR(50)  NULL,
  betting_type      VARCHAR(30)  NOT NULL DEFAULT 'ODDS',
  start_time        DATETIME(3)  NOT NULL,
  status            ENUM('INACTIVE','OPEN','SUSPENDED','CLOSED') NOT NULL DEFAULT 'OPEN',
  in_play           TINYINT(1)   NOT NULL DEFAULT 0,
  turn_in_play      TINYINT(1)   NOT NULL DEFAULT 0,
  admin_suspended   TINYINT(1)   NOT NULL DEFAULT 0,
  is_enabled        TINYINT(1)   NOT NULL DEFAULT 1,
  total_matched     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  display_order     INT          NOT NULL DEFAULT 100,
  settled_at        DATETIME(3)  NULL,
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_markets_betfair (betfair_id),
  KEY idx_markets_event (event_id),
  KEY idx_markets_status (status, settled_at),
  CONSTRAINT fk_markets_event FOREIGN KEY (event_id) REFERENCES events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_runners (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  market_id      BIGINT UNSIGNED NOT NULL,
  selection_id   BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(255) NOT NULL,
  handicap       DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  sort_priority  INT          NOT NULL DEFAULT 0,
  status         ENUM('ACTIVE','WINNER','LOSER','PLACED','REMOVED','REMOVED_VACANT','HIDDEN') NOT NULL DEFAULT 'ACTIVE',
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_runner (market_id, selection_id, handicap),
  CONSTRAINT fk_runner_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Periodic snapshots for charts/audit; live prices are held in memory.
CREATE TABLE odds_snapshots (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  market_id     BIGINT UNSIGNED NOT NULL,
  selection_id  BIGINT UNSIGNED NOT NULL,
  best_back     DECIMAL(8,2)  NULL,
  best_back_size DECIMAL(18,2) NULL,
  best_lay      DECIMAL(8,2)  NULL,
  best_lay_size DECIMAL(18,2) NULL,
  last_traded   DECIMAL(8,2)  NULL,
  captured_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_odds_market_time (market_id, captured_at),
  CONSTRAINT fk_odds_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Betting ─────────────────────────
-- bets       : one bet-slip submission (idempotent per user)
-- bet_items  : one single back/lay bet per selection within the slip
-- bet_orders : exchange order(s) sent to Betfair for a bet item
CREATE TABLE bets (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              CHAR(36)      NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  idempotency_key   VARCHAR(100)  NOT NULL,
  total_stake       DECIMAL(18,2) NOT NULL,
  total_liability   DECIMAL(18,2) NOT NULL,
  status            ENUM('PENDING','PLACED','PARTIAL','FAILED') NOT NULL DEFAULT 'PENDING',
  ip_address        VARCHAR(45)   NULL,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_bets_uuid (uuid),
  UNIQUE KEY uq_bets_user_idem (user_id, idempotency_key),
  KEY idx_bets_user_time (user_id, created_at),
  CONSTRAINT fk_bets_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bet_items (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              CHAR(36)      NOT NULL,
  bet_id            BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  market_id         BIGINT UNSIGNED NOT NULL,
  selection_id      BIGINT UNSIGNED NOT NULL,
  side              ENUM('BACK','LAY') NOT NULL,
  requested_price   DECIMAL(8,2)  NOT NULL,
  stake             DECIMAL(18,2) NOT NULL,
  liability         DECIMAL(18,2) NOT NULL,
  size_matched      DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  avg_price_matched DECIMAL(8,2)  NULL,
  size_cancelled    DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  size_lapsed       DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  status            ENUM('PENDING','UNMATCHED','PARTIALLY_MATCHED','MATCHED','CANCELLED','LAPSED','FAILED','SETTLED','VOIDED') NOT NULL DEFAULT 'PENDING',
  result            ENUM('WIN','LOSS','VOID','PARTIAL') NULL,
  profit_loss       DECIMAL(18,2) NULL,
  commission        DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  failure_code      VARCHAR(50)   NULL,
  placed_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  matched_at        DATETIME(3)   NULL,
  settled_at        DATETIME(3)   NULL,
  updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_bet_items_uuid (uuid),
  KEY idx_items_user_status (user_id, status, placed_at),
  KEY idx_items_user_settled (user_id, settled_at),
  KEY idx_items_market_status (market_id, status),
  KEY idx_items_bet (bet_id),
  CONSTRAINT fk_items_bet FOREIGN KEY (bet_id) REFERENCES bets(id),
  CONSTRAINT fk_items_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_items_market FOREIGN KEY (market_id) REFERENCES markets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bet_orders (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bet_item_id         BIGINT UNSIGNED NOT NULL,
  customer_ref        VARCHAR(32)   NOT NULL,
  betfair_bet_id      VARCHAR(30)   NULL,
  operation           ENUM('PLACE','CANCEL','REPLACE') NOT NULL DEFAULT 'PLACE',
  status              ENUM('SENT','SUCCESS','FAILURE','TIMEOUT') NOT NULL DEFAULT 'SENT',
  order_status        VARCHAR(30)   NULL,
  price               DECIMAL(8,2)  NOT NULL,
  size                DECIMAL(18,2) NOT NULL,
  size_matched        DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  avg_price_matched   DECIMAL(8,2)  NULL,
  error_code          VARCHAR(60)   NULL,
  created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_orders_customer_ref (customer_ref),
  KEY idx_orders_item (bet_item_id),
  KEY idx_orders_betfair (betfair_bet_id),
  CONSTRAINT fk_orders_item FOREIGN KEY (bet_item_id) REFERENCES bet_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per settled bet item: the unique key makes settlement idempotent.
CREATE TABLE settlements (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bet_item_id      BIGINT UNSIGNED NOT NULL,
  market_id        BIGINT UNSIGNED NOT NULL,
  result           ENUM('WIN','LOSS','VOID','PARTIAL') NOT NULL,
  gross_pnl        DECIMAL(18,2) NOT NULL,
  commission       DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  credited_amount  DECIMAL(18,2) NOT NULL,
  source           ENUM('AUTO','MANUAL') NOT NULL DEFAULT 'AUTO',
  settled_by_admin BIGINT UNSIGNED NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_settlement_item (bet_item_id),
  KEY idx_settlement_market (market_id),
  CONSTRAINT fk_settlement_item FOREIGN KEY (bet_item_id) REFERENCES bet_items(id),
  CONSTRAINT fk_settlement_market FOREIGN KEY (market_id) REFERENCES markets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Payments ─────────────────────────
CREATE TABLE deposits (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              CHAR(36)      NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  amount            DECIMAL(18,2) NOT NULL,
  currency          CHAR(3)       NOT NULL,
  provider          VARCHAR(30)   NOT NULL,
  provider_ref      VARCHAR(100)  NULL,
  status            ENUM('PENDING','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  idempotency_key   VARCHAR(100)  NOT NULL,
  failure_reason    VARCHAR(255)  NULL,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at      DATETIME(3)   NULL,
  UNIQUE KEY uq_deposits_uuid (uuid),
  UNIQUE KEY uq_deposits_idem (user_id, idempotency_key),
  UNIQUE KEY uq_deposits_provider_ref (provider, provider_ref),
  KEY idx_deposits_status (status, created_at),
  KEY idx_deposits_user (user_id, created_at),
  CONSTRAINT chk_deposit_amount CHECK (amount > 0),
  CONSTRAINT fk_deposits_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE withdrawals (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              CHAR(36)      NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  amount            DECIMAL(18,2) NOT NULL,
  currency          CHAR(3)       NOT NULL,
  method            VARCHAR(30)   NOT NULL,
  destination_masked VARCHAR(64)  NULL,
  status            ENUM('PENDING','APPROVED','PROCESSING','COMPLETED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  idempotency_key   VARCHAR(100)  NOT NULL,
  reviewed_by_admin BIGINT UNSIGNED NULL,
  review_note       VARCHAR(255)  NULL,
  created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_withdrawals_uuid (uuid),
  UNIQUE KEY uq_withdrawals_idem (user_id, idempotency_key),
  KEY idx_withdrawals_status (status, created_at),
  KEY idx_withdrawals_user (user_id, created_at),
  CONSTRAINT chk_withdrawal_amount CHECK (amount > 0),
  CONSTRAINT fk_withdrawals_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Engagement ─────────────────────────
CREATE TABLE notifications (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  type        VARCHAR(40)   NOT NULL,
  title       VARCHAR(150)  NOT NULL,
  body        VARCHAR(1000) NOT NULL,
  read_at     DATETIME(3)   NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_notifications_user (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE promotions (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(100) NOT NULL,
  title        VARCHAR(150) NOT NULL,
  summary      VARCHAR(300) NOT NULL,
  body         TEXT         NOT NULL,
  badge        VARCHAR(30)  NULL,
  terms        TEXT         NULL,
  starts_at    DATETIME(3)  NOT NULL,
  ends_at      DATETIME(3)  NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_promotions_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Compliance & risk ─────────────────────────
-- Per-user limits. NULL = no user-specific limit (global defaults apply).
-- `pending_*` hold limit increases until `pending_effective_at` (cool-down).
CREATE TABLE user_limits (
  user_id                  BIGINT UNSIGNED PRIMARY KEY,
  max_stake                DECIMAL(18,2) NULL,
  max_exposure             DECIMAL(18,2) NULL,
  daily_deposit_limit      DECIMAL(18,2) NULL,
  weekly_deposit_limit     DECIMAL(18,2) NULL,
  monthly_deposit_limit    DECIMAL(18,2) NULL,
  daily_loss_limit         DECIMAL(18,2) NULL,
  session_time_limit_min   INT UNSIGNED  NULL,
  self_excluded_until      DATETIME(3)   NULL,
  cooling_off_until        DATETIME(3)   NULL,
  betting_restricted       TINYINT(1)    NOT NULL DEFAULT 0,
  withdrawals_restricted   TINYINT(1)    NOT NULL DEFAULT 0,
  pending_changes          JSON          NULL,
  pending_effective_at     DATETIME(3)   NULL,
  set_by                   ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER',
  updated_at               DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_limits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE risk_alerts (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  rule         VARCHAR(50)   NOT NULL,
  severity     ENUM('LOW','MEDIUM','HIGH') NOT NULL,
  details      JSON          NULL,
  status       ENUM('OPEN','REVIEWED','DISMISSED') NOT NULL DEFAULT 'OPEN',
  reviewed_by  BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_alerts_status (status, created_at),
  KEY idx_alerts_user (user_id),
  CONSTRAINT fk_alerts_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_settings (
  setting_key   VARCHAR(80)  PRIMARY KEY,
  setting_value JSON         NOT NULL,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ───────────────────────── Administration ─────────────────────────
CREATE TABLE admin_users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email           VARCHAR(255) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('SUPER_ADMIN','ADMIN','RISK_MANAGER','SUPPORT') NOT NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  totp_secret_enc VARCHAR(255) NULL,
  totp_enabled    TINYINT(1)   NOT NULL DEFAULT 0,
  failed_logins   INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until    DATETIME(3)  NULL,
  last_login_at   DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_admin_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_sessions (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id           BIGINT UNSIGNED NOT NULL,
  family_id          CHAR(36)    NOT NULL,
  refresh_token_hash CHAR(64)    NOT NULL,
  user_agent         VARCHAR(255) NULL,
  ip_address         VARCHAR(45) NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at         DATETIME(3) NOT NULL,
  revoked_at         DATETIME(3) NULL,
  revoked_reason     VARCHAR(50) NULL,
  replaced_by_id     BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_admin_sessions_token (refresh_token_hash),
  KEY idx_admin_sessions_family (family_id),
  CONSTRAINT fk_admin_sessions_admin FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_type    ENUM('ADMIN','USER','SYSTEM') NOT NULL,
  actor_id      BIGINT UNSIGNED NULL,
  action        VARCHAR(80)  NOT NULL,
  target_type   VARCHAR(40)  NULL,
  target_id     VARCHAR(64)  NULL,
  before_state  JSON         NULL,
  after_state   JSON         NULL,
  reason        VARCHAR(500) NULL,
  ip_address    VARCHAR(45)  NULL,
  request_id    VARCHAR(64)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_actor (actor_type, actor_id, created_at),
  KEY idx_audit_target (target_type, target_id),
  KEY idx_audit_action_time (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Outbound Betfair call log (metadata only — never request credentials or tokens).
CREATE TABLE api_logs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider      VARCHAR(30)  NOT NULL,
  operation     VARCHAR(80)  NOT NULL,
  status        ENUM('OK','ERROR','TIMEOUT') NOT NULL,
  duration_ms   INT UNSIGNED NOT NULL,
  error_code    VARCHAR(80)  NULL,
  request_id    VARCHAR(64)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_api_logs_time (created_at),
  KEY idx_api_logs_op (operation, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generic HTTP idempotency store for mutating endpoints (Idempotency-Key header).
CREATE TABLE idempotency_keys (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope          VARCHAR(60)  NOT NULL,
  actor_id       BIGINT UNSIGNED NOT NULL,
  idem_key       VARCHAR(100) NOT NULL,
  request_hash   CHAR(64)     NOT NULL,
  status         ENUM('IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
  response_code  INT          NULL,
  response_body  JSON         NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_idem (scope, actor_id, idem_key),
  KEY idx_idem_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(100) PRIMARY KEY,
  applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
