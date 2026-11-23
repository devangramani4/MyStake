# Exchange data services (browser side)

These modules are the frontend's only entry point to exchange data. They call
**our Node.js API**, which owns the Betfair integration — the browser never
talks to Betfair and never sees Betfair credentials, session tokens or app keys.

| File | Backend endpoint(s) |
|------|---------------------|
| `authService.ts` | `GET /health` — exchange session/feed status for UI banners |
| `sportsService.ts` | `GET /sports`, `GET /sports/:slug/competitions` |
| `eventsService.ts` | `GET /events`, `GET /events/:id`, `GET /scores` |
| `marketsService.ts` | `GET /markets/:id/book`, `GET /markets/books` |
| `oddsService.ts` | WebSocket `/ws` market subscriptions (live prices) |
| `bettingService.ts` | `POST /bets` (idempotent) |
