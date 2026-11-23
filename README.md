# BetX — Betting Exchange Platform

A web-only betting exchange: a React customer app, a separate React admin console, a Node.js/TypeScript API that owns the Betfair integration, and MySQL.

> **BetX is a placeholder brand.** Replace the name (`VITE_BRAND_NAME`, `APP_NAME`), logo (`frontend/src/components/layout/Logo.tsx`) and legal pages with your own licensed assets. No third-party branding is included.

> **Compliance.** This codebase provides configurable controls (age checks, KYC status, limits, self-exclusion, geo-restriction, audit trail). It makes **no claim that operating is lawful in any jurisdiction**. Before real-money operation, verify gambling licensing, payments, KYC/AML, tax, advertising rules and your Betfair agreement for each target market.

---

## Contents

1. [Architecture](#architecture)
2. [Features](#features)
3. [Project structure](#project-structure)
4. [Quick start (local)](#quick-start-local)
5. [Configuration](#configuration)
6. [Betfair integration](#betfair-integration)
7. [How money moves](#how-money-moves)
8. [Real-time protocol](#real-time-protocol)
9. [Security](#security)
10. [Testing](#testing)
11. [Docker](#docker)
12. [Production deployment](#production-deployment)
13. [API reference](#api-reference)
14. [Development phases — status](#development-phases--status)
15. [Known limitations / next steps](#known-limitations--next-steps)

---

## Architecture

```
 ┌──────────────────┐      ┌──────────────────┐
 │ React web app    │      │ React admin app  │      Browser: no Betfair credentials,
 │ (frontend/)      │      │ (admin/)         │      no balances computed client-side
 └───────┬──────────┘      └────────┬─────────┘
   REST (axios) + WebSocket         │ REST
         ▼                          ▼
 ┌──────────────────────────────────────────────────────────┐
 │ Node.js API  (backend/)                                   │
 │  routes → controllers → services ──► MySQL (InnoDB)       │
 │                    │                                      │
 │                    ▼                                      │
 │  integrations/betfair  (only place that talks to Betfair) │
 │   auth · navigation · marketCatalogue · marketBook ·      │
 │   order · account · stream          [ mock/ for dev ]     │
 │                    │                                      │
 │  oddsService (price hub) ──► websocket/wsServer ──► /ws   │
 │  jobs: catalogue sync · order reconcile · settlement      │
 └────────────────────┬─────────────────────────────────────┘
                      ▼
        Betfair API-NG (JSON-RPC) + Exchange Stream API
```

Live market data flow: **Betfair Stream API → `BetfairStream` (delta merge, heartbeat, clk resume) → `oddsService` hub (admin-suspension overlay, state persistence, settlement trigger) → WebSocket fan-out (per-market subscriptions) → React socket client → Redux (`marketsSlice`, coalesced per animation frame) → only the affected `OddsButton` re-renders.**

## Features

**Customer web app** (`frontend/`, React 19 + TypeScript + Redux Toolkit + React Router + Axios)

- Home (hero, stats, featured sports, live/popular/upcoming events, promotions), Sports, per-sport pages (competitions, filters, debounced search, virtualised list), Event page (full exchange ladder per market), Live betting, Promotions.
- Exchange UI: 3-deep **BACK/LAY** ladder with available size; distinct styles for back, lay, suspended, selected and moved prices (subtle flash on best-price changes).
- **Bet slip**: back & lay, odds stepper on the Betfair ladder, quick stakes, liability / profit / return, live checks (suspension, runner removed, odds changed with one-click accept, liquidity), “keep unmatched” option, **confirmation screen**, idempotent submission (double-clicks and retries can't duplicate), open-bets tab with cancel.
- Live scores panel (cricket: score, overs, run rate, required rate, target, wickets, partnership; timeline) when a score feed is available.
- Account: dashboard with P&L chart, My bets (open / settled / history with Today, Yesterday, 7 days, 30 days, custom date, sport, status/result and back/lay filters), Wallet, Deposit, Withdrawal, Transactions ledger, Profile, Security (password, TOTP 2FA, device/session list), Notifications, Responsible gambling (limits, cooling-off, self-exclusion).
- Public pages: Login, Register, Forgot/Reset password, Email verification, Terms, Privacy, Responsible Gambling, Contact.
- Responsive: desktop *Header / Sidebar / Main / Bet slip*; tablet drops the sidebar into a drawer; phones get a bottom nav and the bet slip as a bottom sheet.

**Admin console** (`admin/`) — dashboard (users, active users, bets, open/settled, stakes, customer P/L, commission revenue, deposits, withdrawals, risk alerts, API status, charts), user management (search, profile, suspend/activate, KYC, wallet, bets, transactions, limits/restrictions, audited manual adjustments), bets (open/settled/failed/pending), sports & markets (enable/feature/hide, admin-suspend markets, manual settle/void, catalogue sync), finance (deposit confirmation, withdrawal approval, ledger), risk (alerts, exposure by market, platform limits/commission/compliance settings), admin users & roles, audit log, Betfair API status.

**Backend** (`backend/`, Node 22 + Express 5 + TypeScript + mysql2 + ws + zod + pino)

- JWT access tokens + rotating opaque refresh tokens (httpOnly cookies) with reuse detection, argon2id hashing, lockout, TOTP 2FA, email verification, password reset, session/device management.
- Double-entry style append-only wallet ledger; every balance change in a DB transaction with row locks and idempotency keys.
- Bet placement → Betfair `placeOrders`, ambiguous-outcome handling (timeouts reconciled via `customerOrderRef`), cancel / replace (edit odds) of unmatched orders, automatic settlement with commission on net market winnings, void / non-runner handling, manual settlement.
- Risk: platform and per-user max stake, max exposure, daily loss limit, odds cap; suspicious-activity rules (large stake vs history, rapid betting, many failures).
- Compliance: minimum age, KYC status (withdrawals gated), terms versioning/re-acceptance, deposit limits with cool-down on increases, cooling-off, self-exclusion (revokes sessions), geo-restriction by CDN country header, audit trail.
- Structured JSON logs with secret redaction; `api_logs` metadata for every Betfair call.

## Project structure

```
.
├── frontend/                     Customer web app (Vite + React + TS)
│   └── src/
│       ├── components/           ui/ (Modal, Drawer, Toast, Pagination, States…), betting/ (OddsButton,
│       │                         BackButton, LayButton, MarketCard, BetSlip, BetRow), sports/ (EventCard,
│       │                         SportCard, SportsMenu, ScoreCard), account/ (WalletCard, TransactionTable,
│       │                         BetHistoryTable, PnlChart), layout/ (Header, Sidebar, Footer, BottomNav…)
│       ├── pages/                public/, auth/, account/, info/
│       ├── layouts/              MainLayout, AccountLayout (+ RequireAuth)
│       ├── hooks/                useMarketSubscription, useEvents, useSports, useMediaQuery, useDebounce…
│       ├── store/                slices (auth, wallet, markets, betslip, ui, scores), selectors, realtime bridge
│       ├── services/
│       │   ├── api/              http (axios + refresh), auth, account, content
│       │   ├── betfair/          authService, sportsService, eventsService, marketsService,
│       │   │                     oddsService, bettingService  (all call OUR API — never Betfair)
│       │   └── ws/socket.ts      reconnecting WebSocket client with heartbeat
│       ├── utils/  types/  styles/
│       └── App.tsx
├── admin/                        Admin console (separate Vite app; shares design tokens)
├── backend/
│   ├── server.ts                 HTTP + WebSocket bootstrap, graceful shutdown
│   ├── src/
│   │   ├── config/               env (zod-validated), db (pool + withTransaction)
│   │   ├── controllers/  routes/  middleware/ (auth, csrf, rate limits, validation, errors)
│   │   ├── services/             auth, token, wallet, bet, settlement, odds, market, payment,
│   │   │                         compliance, risk, admin, notification, audit, settings, permissions
│   │   ├── integrations/
│   │   │   ├── betfair/          auth, http (JSON-RPC), navigation, marketCatalogue, marketBook,
│   │   │   │                     order, account, stream, liveClient, client (interface), errors
│   │   │   │   └── mock/         DEVELOPMENT/TEST-ONLY simulated exchange + scores
│   │   │   ├── payments/         PaymentProvider interface (mock / manual)
│   │   │   └── scores/           ScoreProvider interface
│   │   ├── websocket/            wsServer (per-market fan-out, auth, heartbeat, backpressure)
│   │   ├── jobs/                 catalogue sync, reconciliation, settlement, housekeeping
│   │   ├── models/  utils/       money (integer cents), exchange maths & price ladder, logger…
│   ├── scripts/                  migrate.ts, seed.ts
│   └── tests/                    unit/, betfair/ (fixtures-based), integration/ (real MySQL)
├── database/
│   ├── migrations/001_core_schema.sql
│   └── seeds/                    001 reference data (all envs) · 9xx dev-only content
├── docker/                       Dockerfiles, nginx (local + TLS production), backup/restore scripts
├── docker-compose.yml
├── .github/workflows/ci.yml
└── .env.example
```

## Quick start (local)

Requirements: **Node 22+**, **MySQL 8.0+** (MariaDB 10.11 also works for development).

```bash
# 1. Install all workspaces
npm install

# 2. Database
mysql -uroot -e "CREATE DATABASE betx; CREATE USER 'betx'@'localhost' IDENTIFIED BY 'change-me';
                 GRANT ALL ON betx.* TO 'betx'@'localhost';"

# 3. Configure the API
cp .env.example backend/.env
#    then set DATABASE_PASSWORD and generate secrets:
#    JWT_ACCESS_SECRET, JWT_ADMIN_ACCESS_SECRET, ENCRYPTION_KEY  →  openssl rand -hex 32
#    For a first run also set ADMIN_EMAIL / ADMIN_PASSWORD and SEED_DEV_DATA=true

# 4. Schema + reference data (+ first SUPER_ADMIN, + demo user when SEED_DEV_DATA=true)
npm run db:migrate
npm run db:seed

# 5. Run (three terminals)
npm run dev:backend     # http://localhost:4000   (BETFAIR_MODE=mock by default)
npm run dev:frontend    # http://localhost:5173   (proxies /api and /ws to :4000)
npm run dev:admin       # http://localhost:5174
```

With `SEED_DEV_DATA=true` a demo customer is created: **demo / DemoPass123** (verified, KYC verified, zero balance — deposit from the Wallet page; `PAYMENT_PROVIDER=mock` credits instantly).

Development emails (verification, password reset) are captured in memory and readable at `GET http://localhost:4000/api/dev/mailbox` when SMTP isn't configured. That route is not mounted when `NODE_ENV=production`.

## Configuration

All variables are documented in [`.env.example`](.env.example) and validated at start-up (`backend/src/config/env.ts`); the API refuses to start on missing/invalid values and only prints the **names** of bad variables, never their values.

Production safety switches:

| Rule | Effect |
|------|--------|
| `NODE_ENV=production` + `BETFAIR_MODE=mock` | refused (unless `ALLOW_MOCK_IN_PRODUCTION=true`) |
| `NODE_ENV=production` + `PAYMENT_PROVIDER=mock` | refused |
| `NODE_ENV=production` + `COOKIE_SECURE=false` | refused |
| `BETFAIR_MODE=live` without app key / username / password / cert | refused |
| `SEED_DEV_DATA=true` in production | seed script refuses |

Runtime-editable settings (risk defaults, alert thresholds, commission rate, compliance toggles) live in `system_settings` and are edited from **Admin → Risk** (SUPER_ADMIN), with every change audited.

## Betfair integration

All Betfair access goes through `backend/src/integrations/betfair/`, behind the `BetfairClient` / `MarketStream` interfaces (`client.ts`). Nothing else imports Betfair code, and the browser only talks to our API.

| Module | Betfair operation(s) |
|--------|----------------------|
| `auth.ts` | Non-interactive **certificate login** (`certlogin`), session token caching, automatic `keepAlive`, de-duplicated re-login |
| `http.ts` | JSON-RPC transport for `SportsAPING` / `AccountAPING`, timeouts, HTTP 429/5xx mapping, transparent re-login on `INVALID_SESSION_INFORMATION`, call metadata → `api_logs` |
| `navigation.ts` | `listEventTypes`, `listCompetitions`, `listEvents` |
| `marketCatalogue.ts` | `listMarketCatalogue` (event, competition, start time, description, runners) |
| `marketBook.ts` | `listMarketBook` (EX_BEST_OFFERS depth 3, batched for request-weight limits) → UI snapshots |
| `order.ts` | `placeOrders` (with `customerRef` / `customerOrderRef`), `cancelOrders`, `replaceOrders`, `listCurrentOrders` |
| `account.ts` | `getAccountFunds` |
| `stream.ts` | **Exchange Stream API** client (TLS, CRLF JSON, authentication, `marketSubscription`, image + delta merge, `clk`/`initialClk` resume, heartbeat watchdog, exponential reconnect) and a `listMarketBook` polling fallback |
| `errors.ts` | Maps Betfair error codes → safe user-facing codes; raw details never reach clients |

### Going live

1. Get a Betfair **application key** and an account allowed for API access in your jurisdiction.
2. Create a self-signed client certificate and upload it to your Betfair account ([Betfair docs: non-interactive login](https://docs.developer.betfair.com/display/1smk3cen4v3lu3yomq5qye0ni/Non-Interactive+%28bot%29+login)):
   ```bash
   openssl genrsa -out client-2048.key 2048
   openssl req -new -key client-2048.key -out client-2048.csr
   openssl x509 -req -days 365 -in client-2048.csr -signkey client-2048.key -out client-2048.crt
   ```
3. Store the cert and key **outside the repo** (e.g. a secrets mount) and set `BETFAIR_MODE=live`, `BETFAIR_APP_KEY`, `BETFAIR_USERNAME`, `BETFAIR_PASSWORD`, `BETFAIR_CERT_PATH`, `BETFAIR_KEY_PATH`. Use the endpoint set for your jurisdiction (`BETFAIR_API_URL`, `BETFAIR_IDENTITY_URL`, `BETFAIR_STREAM_HOST`).
4. Market data works immediately. **Order placement stays disabled** until you set `BETFAIR_PLACE_ORDERS=true` — only do this once your Betfair agreement permits placing orders on behalf of your platform's customers.
5. Live mode has no built-in score feed (the betting API doesn't provide scores). Implement `ScoreProvider` (`integrations/scores/types.ts`) for your licensed data provider; the UI hides the score panel when no scores exist.

### Mock mode (development / tests only)

`BETFAIR_MODE=mock` swaps in `integrations/betfair/mock/` — a deterministic in-memory exchange implementing the same interfaces: a catalogue across all 13 sports, moving prices, in-play turn, occasional suspensions, order matching (full / partial / unmatched), lapsing, settlement with winners, and synthetic live scores. It is loaded via dynamic import only in mock mode, and refused in production. Restarting the API in mock mode creates a fresh simulated catalogue; bets left open on the previous run's markets can be voided/settled from **Admin → Sports & markets**.

## How money moves

Amounts are handled as **integer minor units** in code and `DECIMAL(18,2)` in MySQL. The client never sends or computes balances.

| Concept | Definition |
|---------|-----------|
| `balance` | Available funds (bet / withdraw) |
| `exposure` | Funds reserved as liability for open bets |
| total | `balance + exposure` |

Every change goes through `walletService.applyLedger()` inside a transaction: row-lock the wallet (`SELECT … FOR UPDATE`), enforce non-negative balance/exposure (also DB `CHECK`s), append to `wallet_transactions` with a **unique idempotency key**. Ledger types: `DEPOSIT, WITHDRAWAL, BET, WIN, LOSS, REFUND, COMMISSION, ADJUSTMENT`.

**Bet lifecycle**

1. `POST /api/bets` with an `Idempotency-Key` header (one key per user confirmation; the slip reuses it on retry). A repeated key returns the original bet — no duplicate is possible (`UNIQUE(user_id, idempotency_key)`).
2. Validation: account status, email verified, terms version, self-exclusion / cooling-off / restrictions, ladder-valid price, min/max stake, odds cap, max exposure, daily loss limit, live market status, runner status, price & liquidity (unless *keep unmatched*).
3. Tx 1: insert `bets` / `bet_items` / `bet_orders`, move liability `balance → exposure` (`BET`).
4. `placeOrders` per market. Success → matched size / avg price applied. Definite failure → item `FAILED`, liability refunded (`REFUND`). Timeout / network error → item stays `PENDING`; the reconciler looks the order up by `customerOrderRef` and either applies it or, after 60 s without trace, fails and refunds it.
5. Unmatched portions can be cancelled or re-priced; cancelled or lapsed stake releases its liability.
6. Settlement (stream sees `CLOSED` with WINNER/LOSER, or the 30 s job polls closed markets): per user and market, inside one transaction — `credit = reserved + P&L`, commission on **net positive market winnings**, `settlements.bet_item_id` is unique, ledger keys are deterministic → safe to run repeatedly. Void markets and non-runners refund in full; partly matched bets settle the matched part and refund the rest (`PARTIAL`).

Exchange maths: BACK liability = stake, profit = stake × (odds − 1). LAY liability = stake × (odds − 1), profit = backer's stake.

Deposits/withdrawals use a `PaymentProvider` interface (`mock` for development, `manual` for admin-confirmed bank transfer). Withdrawals debit immediately and are refunded if cancelled/rejected; KYC can be required (default on).

## Real-time protocol

WebSocket at `/ws` (JSON messages):

| Client → server | |
|---|---|
| `{type:'auth', token}` | attach the user's access token (for wallet/bet/notification pushes) |
| `{type:'subscribe', markets?:[], events?:[]}` | start receiving those markets' books / events' scores (current state is sent immediately) |
| `{type:'unsubscribe', …}` / `{type:'logout'}` / `{type:'ping', ts}` | |

| Server → client | |
|---|---|
| `market` | full snapshot of **one** market (status, in-play, runners with 3-deep back/lay) |
| `score` | live score for one event |
| `wallet`, `bet`, `notification` | user-scoped pushes |
| `feed` / `hello` | exchange feed connectivity |
| `pong` | heartbeat reply |

Server pings every 20 s and terminates dead sockets; slow consumers skip frames (each snapshot supersedes the last). The client reconnects with jittered exponential back-off, re-subscribes everything, and shows a banner if prices may be stale.

## Security

- **Passwords**: argon2id. Login lockout after 5 failures; timing-equalised unknown-user path.
- **Tokens**: short-lived HS256 access JWTs (separate secrets/audiences for customers and admins) kept in memory; refresh tokens are random, stored only as SHA-256 hashes, rotated on every use, sent as `httpOnly; Secure; SameSite=Strict` cookies scoped to the auth path. Re-use of a rotated token revokes the whole session family. Money-moving endpoints and every admin request re-check that the session is still live.
- **CSRF**: the only cookie-authenticated endpoints (refresh/logout) require a double-submit `X-CSRF-Token` and an allowed `Origin`; all other endpoints use the `Authorization` header.
- **Input**: zod validation on every request body/query; parameterised SQL everywhere (no string-built user input); JSON body limit; React escapes output; strict CSP via nginx.
- **Transport/headers**: Helmet, HSTS in production, CORS allow-list, nginx TLS config.
- **Rate limits**: global, auth, password reset, bets and wallet (per user). Use a shared store when running multiple instances.
- **RBAC**: `SUPER_ADMIN, ADMIN, RISK_MANAGER, SUPPORT` (+ `USER`), permission matrix in `services/permissions.ts`, enforced server-side; admin UI hides what a role can't do.
- **Audit**: admin actions, financial overrides, auth/security events written to `audit_logs` (with before/after and mandatory reason), in the same transaction as the change.
- **Secrets**: only in server env/secret mounts; logs redact passwords, tokens, cookies, app keys, card/account numbers; 2FA seeds encrypted at rest (AES-256-GCM); withdrawal destinations stored masked.
- **Errors**: clients get stable codes and friendly messages plus a request id; internal/Betfair details stay in logs.

## Testing

```bash
# backend: unit + Betfair-layer (mocked HTTP/stream fixtures) + integration (real MySQL)
mysql -uroot -e "CREATE DATABASE betx_test; GRANT ALL ON betx_test.* TO 'betx'@'localhost';"
npm test --workspace backend        # uses TEST_DATABASE_NAME (default betx_test) — it is wiped
npm test --workspace frontend       # store, exchange maths, OddsButton behaviour
```

Covered: authentication (registration, argon2, lockout, refresh rotation + reuse detection, CSRF, logout, password reset, 2FA), wallet (idempotent deposits, limits & cool-down, KYC-gated withdrawals, client-supplied balances ignored), bet placement (back/lay liability, duplicate prevention under concurrent requests, no overdraft under concurrency, odds changed, insufficient liquidity, suspended market, invalid price/stake, exchange rejection refund, timeout → reconcile, cancel and re-price unmatched, self-exclusion), settlement (win/loss with commission, hedged net commission, void, partial, idempotent re-runs, non-runners), admin permissions and audited adjustments, Betfair layer (JSON-RPC mapping, re-login, failures, timeout, stream image/delta/suspend/close using recorded-format fixtures in `backend/tests/fixtures/betfair`).

CI (`.github/workflows/ci.yml`) runs typechecks, both test suites against MySQL 8.4 and both production builds.

## Docker

```bash
cp .env.example .env    # set DATABASE_PASSWORD, MYSQL_ROOT_PASSWORD, JWT/ENCRYPTION secrets, ADMIN_EMAIL/PASSWORD
docker compose up --build
# web   → http://localhost:8080      admin → http://localhost:8081
```

`migrate` runs migrations + seeds once, `api` serves REST/WebSocket and runs jobs, `web` (nginx) serves both SPAs and proxies `/api` and `/ws`.

## Production deployment

**HTTPS.** Terminate TLS at your load balancer or with `docker/nginx/production.conf` (TLS 1.2/1.3, HSTS, CSP, rate limiting, HTTP→HTTPS redirect, ACME challenge path). Set `COOKIE_SECURE=true`, `TRUST_PROXY=1` (or the number of proxy hops), `CORS_ORIGINS` and `PUBLIC_WEB_URL` to your real origins. Serve the admin console on a separate host restricted to VPN/office IPs.

**Environment.** Inject secrets from a secrets manager (not files in the image). Rotate `JWT_*` secrets by deploying new values (all users re-authenticate). Mount the Betfair certificate read-only.

**Scaling.** The API is stateless except for three in-process pieces you must externalise before running more than one instance: the domain event bus (`utils/eventBus.ts` → Redis pub/sub), rate-limit counters (→ `rate-limit-redis`), and the background jobs (run them on exactly one instance: `JOBS_ENABLED=true` there, `false` elsewhere). Put WebSocket connections behind sticky sessions or a pub/sub fan-out. Use a MySQL primary with read replicas for reporting queries.

**Monitoring.** Logs are structured JSON on stdout (request id, user/admin id, operation, Betfair error codes) — ship them to your log platform and alert on: `level>=50`, `bet request` without `bet response`, `refresh token reuse detected`, `risk alert raised`, `market stream status connected=false`, `job failed`, and `api_logs` error rate. `GET /health` reports DB and Betfair session/stream status for load-balancer and uptime checks. Admin → API status shows per-operation call counts/latency for the last hour.

**Backups & disaster recovery.**
- `docker/backup/backup.sh`: consistent `mysqldump --single-transaction`, gzip, optional GPG encryption, checksum, upload hook, retention. Run every few hours; enable binary logs for point-in-time recovery between dumps.
- `docker/backup/restore.sh`: restores into a separate database and runs a **ledger reconciliation check** (wallet balances must equal the sum of their ledger rows) before cut-over.
- Rehearse restores regularly. Recovery order: restore DB → start API with `JOBS_ENABLED=true` → the reconciler and settlement jobs re-sync open orders and settle markets that closed during the outage (idempotent by design).

## API reference

Base path `/api`. Errors: `{ error: { code, message, details?, requestId } }`.

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/register` · `/auth/login` · `/auth/refresh`* · `/auth/logout`* · `/auth/forgot-password` · `/auth/reset-password` · `/auth/verify-email` · `/auth/resend-verification` |
| Catalogue | `GET /sports` · `/sports/:slug/competitions` · `/events?sport&competition&status&q&page` · `/events/:id` · `/markets/books?ids=` · `/markets/:id/book` · `/scores?eventIds=` · `/promotions` · `/stats` |
| Account | `GET/PATCH /me` · `POST /me/accept-terms` · `/me/password` · `GET /me/sessions` · `DELETE /me/sessions/:id` · `POST /me/2fa/setup|enable|disable` · `GET/PUT /me/limits` · `POST /me/self-exclusion` · `/me/cool-off` · `GET /me/notifications` · `POST /me/notifications/read` |
| Bets | `POST /bets`† · `GET /bets?view&range&from&to&sport&side&status&result` · `GET /bets/:id` · `POST /bets/:id/cancel` · `POST /bets/:id/replace` |
| Wallet | `GET /wallet` · `/wallet/transactions` · `POST /wallet/deposits`† · `GET /wallet/deposits` · `POST /wallet/withdrawals`† · `GET /wallet/withdrawals` · `POST /wallet/withdrawals/:id/cancel` |
| Admin | `/admin/auth/*` · `/admin/dashboard` · `/admin/users[/:id[/bets|transactions|status|kyc|restrictions|adjustments†]]` · `/admin/bets` · `/admin/sports|events|markets/:id/flags` · `/admin/markets/:id/settle` · `/admin/catalogue/sync` · `/admin/transactions|deposits|withdrawals[/:id/review]` · `/admin/risk/alerts|exposure` · `/admin/settings[/:key]` · `/admin/admins` · `/admin/audit-logs` · `/admin/api-health` |

\* cookie + `X-CSRF-Token` · † requires `Idempotency-Key`

## Development phases — status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | React setup, Node backend, MySQL, authentication, layout, admin auth | ✅ |
| 2 | Betfair auth, sports / competitions / events / markets APIs | ✅ (live client + mock) |
| 3 | Market data, odds display, back/lay UI, real-time updates | ✅ |
| 4 | Bet slip, placement, open bets, history | ✅ |
| 5 | Wallet, ledger, deposit/withdrawal architecture | ✅ (provider interface; real PSP to integrate) |
| 6 | Admin dashboard, risk, user and betting management | ✅ |
| 7 | Performance, security hardening, logging, error handling, tests | ✅ |
| 8 | Deployment, HTTPS, env config, monitoring, backup, DR | ✅ configs & runbook (infrastructure itself is yours to provision) |

## Known limitations / next steps

- **Live Betfair calls were not exercised here** — the live client is written against the published API-NG / Stream API contracts and tested with recorded-format fixtures; validate against Betfair's integration environment with your app key before launch.
- **Payments**: only `mock` and `manual` providers are included; integrate a licensed PSP through `PaymentProvider` and verify webhook signatures.
- **KYC**: status workflow exists; document upload / identity-provider integration is not included.
- **Scores & streaming**: `ScoreProvider` needs a licensed feed in live mode; the video-stream indicator is driven by `events.has_stream` (set it from your streaming provider).
- **Multi-instance**: replace the in-process event bus and rate-limit store with Redis before scaling horizontally (see *Scaling*).
- **Settlement edge cases** not modelled: Betfair reduction factors for horse-racing non-runners, dead-heat rules, Asian-handicap half-wins and resettlements — extend `settlementService` from `listClearedOrders` if you offer those markets.
- Legal pages are templates and must be replaced with jurisdiction-approved documents.
