import { Router } from 'express';
import { env, isProd } from '../config/env.js';
import * as adminCtl from '../controllers/adminController.js';
import * as authCtl from '../controllers/authController.js';
import * as betCtl from '../controllers/betController.js';
import * as catalogCtl from '../controllers/catalogController.js';
import * as userCtl from '../controllers/userController.js';
import * as walletCtl from '../controllers/walletController.js';
import { requireAdmin, requireLiveSession, requirePermission, requireUser } from '../middleware/auth.js';
import { ADMIN_CSRF_COOKIE, USER_CSRF_COOKIE, verifyCsrf } from '../middleware/csrf.js';
import { adminLimiter, authLimiter, betLimiter, passwordResetLimiter, walletLimiter } from '../middleware/rateLimit.js';
import { devMailbox } from '../services/emailService.js';

export const api = Router();

// ── Auth ───────────────────────────────────────────────────────────────
api.post('/auth/register', authLimiter, authCtl.register);
api.post('/auth/login', authLimiter, authCtl.login);
api.post('/auth/refresh', verifyCsrf(USER_CSRF_COOKIE), authCtl.refresh);
api.post('/auth/logout', verifyCsrf(USER_CSRF_COOKIE), authCtl.logout);
api.post('/auth/forgot-password', passwordResetLimiter, authCtl.forgotPassword);
api.post('/auth/reset-password', passwordResetLimiter, authCtl.resetPassword);
api.post('/auth/verify-email', authLimiter, authCtl.verifyEmail);
api.post('/auth/resend-verification', requireUser, passwordResetLimiter, authCtl.resendVerification);

// ── Public catalogue ───────────────────────────────────────────────────
api.get('/sports', catalogCtl.sports);
api.get('/sports/:sport/competitions', catalogCtl.competitions);
api.get('/events', catalogCtl.events);
api.get('/events/:eventId', catalogCtl.event);
api.get('/markets/books', catalogCtl.books);
api.get('/markets/:marketId/book', catalogCtl.book);
api.get('/scores', catalogCtl.scores);
api.get('/promotions', catalogCtl.promotions);
api.get('/stats', catalogCtl.stats);

// ── Account ────────────────────────────────────────────────────────────
const me = Router();
me.use(requireUser);
me.get('/', userCtl.me);
me.patch('/', userCtl.updateProfile);
me.post('/accept-terms', userCtl.acceptTerms);
me.post('/password', requireLiveSession, userCtl.changePassword);
me.get('/sessions', userCtl.sessions);
me.delete('/sessions/:id', userCtl.revokeSession);
me.post('/2fa/setup', requireLiveSession, userCtl.begin2fa);
me.post('/2fa/enable', requireLiveSession, userCtl.enable2fa);
me.post('/2fa/disable', requireLiveSession, userCtl.disable2fa);
me.get('/limits', userCtl.getLimits);
me.put('/limits', requireLiveSession, userCtl.setLimits);
me.post('/self-exclusion', requireLiveSession, userCtl.selfExclude);
me.post('/cool-off', requireLiveSession, userCtl.coolOff);
me.get('/notifications', userCtl.listNotifications);
me.post('/notifications/read', userCtl.readNotifications);
api.use('/me', me);

// ── Betting ────────────────────────────────────────────────────────────
const bets = Router();
bets.use(requireUser);
bets.post('/', betLimiter, requireLiveSession, betCtl.place);
bets.get('/', betCtl.list);
bets.get('/:id', betCtl.get);
bets.post('/:id/cancel', betLimiter, betCtl.cancel);
bets.post('/:id/replace', betLimiter, requireLiveSession, betCtl.replace);
api.use('/bets', bets);

// ── Wallet ─────────────────────────────────────────────────────────────
const wallet = Router();
wallet.use(requireUser);
wallet.get('/', walletCtl.summary);
wallet.get('/transactions', walletCtl.transactions);
wallet.post('/deposits', walletLimiter, requireLiveSession, walletCtl.deposit);
wallet.get('/deposits', walletCtl.deposits);
wallet.post('/withdrawals', walletLimiter, requireLiveSession, walletCtl.withdraw);
wallet.get('/withdrawals', walletCtl.withdrawals);
wallet.post('/withdrawals/:id/cancel', walletLimiter, walletCtl.cancelWithdrawal);
api.use('/wallet', wallet);

// ── Admin ──────────────────────────────────────────────────────────────
api.post('/admin/auth/login', authLimiter, adminCtl.login);
api.post('/admin/auth/refresh', verifyCsrf(ADMIN_CSRF_COOKIE), adminCtl.refresh);
api.post('/admin/auth/logout', verifyCsrf(ADMIN_CSRF_COOKIE), adminCtl.logout);

const admin = Router();
admin.use(adminLimiter, requireAdmin);
const p = requirePermission;
admin.get('/me', adminCtl.me);
admin.get('/dashboard', p('dashboard:view'), adminCtl.dashboard);
admin.get('/api-health', p('dashboard:view'), adminCtl.apiHealth);

admin.get('/users', p('users:view'), adminCtl.users);
admin.get('/users/:id', p('users:view'), adminCtl.user);
admin.get('/users/:id/transactions', p('finance:view'), adminCtl.userTransactions);
admin.get('/users/:id/bets', p('bets:view'), adminCtl.userBets);
admin.post('/users/:id/status', p('users:manage'), adminCtl.setUserStatus);
admin.post('/users/:id/kyc', p('users:manage'), adminCtl.setKyc);
admin.post('/users/:id/restrictions', p('risk:manage'), adminCtl.setRestrictions);
admin.post('/users/:id/adjustments', p('wallet:adjust'), adminCtl.adjustWallet);

admin.get('/bets', p('bets:view'), adminCtl.bets);

admin.get('/sports', p('dashboard:view'), adminCtl.sports);
admin.get('/events', p('dashboard:view'), adminCtl.events);
admin.get('/events/:id/markets', p('dashboard:view'), adminCtl.eventMarkets);
admin.post('/sports/:id/flags', p('sports:manage'), adminCtl.setFlag('sports'));
admin.post('/competitions/:id/flags', p('sports:manage'), adminCtl.setFlag('competitions'));
admin.post('/events/:id/flags', p('sports:manage'), adminCtl.setFlag('events'));
admin.post('/markets/:id/flags', p('sports:manage'), adminCtl.setFlag('markets'));
admin.post('/markets/:id/settle', p('bets:manage'), adminCtl.settleMarket);
admin.post('/catalogue/sync', p('sports:manage'), adminCtl.syncNow);

admin.get('/transactions', p('finance:view'), adminCtl.transactions);
admin.get('/deposits', p('finance:view'), adminCtl.payments('deposits'));
admin.get('/withdrawals', p('finance:view'), adminCtl.payments('withdrawals'));
admin.post('/deposits/:uuid/review', p('finance:manage'), adminCtl.reviewDeposit);
admin.post('/withdrawals/:uuid/review', p('finance:manage'), adminCtl.reviewWithdrawalCtl);

admin.get('/risk/alerts', p('users:view'), adminCtl.alerts);
admin.post('/risk/alerts/:id', p('risk:manage'), adminCtl.reviewAlert);
admin.get('/risk/exposure', p('users:view'), adminCtl.exposure);
admin.get('/settings', p('dashboard:view'), adminCtl.settings);
admin.put('/settings/:key', p('settings:manage'), adminCtl.updateSettings);

admin.get('/admins', p('admins:manage'), adminCtl.admins);
admin.post('/admins', p('admins:manage'), adminCtl.createAdmin);
admin.patch('/admins/:id', p('admins:manage'), adminCtl.updateAdmin);
admin.get('/audit-logs', p('audit:view'), adminCtl.auditLogs);
api.use('/admin', admin);

// ── Development helpers (never mounted in production) ─────────────────
if (!isProd) {
  api.get('/dev/mailbox', (_req, res) => {
    res.json({ items: devMailbox });
  });
  api.get('/dev/config', (_req, res) => {
    res.json({ betfairMode: env.BETFAIR_MODE, paymentProvider: env.PAYMENT_PROVIDER });
  });
}
