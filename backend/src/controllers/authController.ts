import type { Request, Response } from 'express';
import { z } from 'zod';
import { clientInfo } from '../middleware/requestContext.js';
import { parse } from '../middleware/validate.js';
import * as auth from '../services/authService.js';
import { AppError } from '../utils/errors.js';
import { clearRefreshCookie, setRefreshCookie, USER_AUTH_PATH, USER_RT } from './cookies.js';

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

const registerSchema = z.object({
  email: z.string().trim().email().max(255),
  username: z.string().trim().regex(/^[A-Za-z0-9_]{3,32}$/, '3–32 letters, numbers or underscores'),
  password: passwordSchema,
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  countryCode: z.string().length(2).optional(),
  acceptTerms: z.literal(true, { message: 'You must accept the terms' }),
});

const loginSchema = z.object({ identifier: z.string().trim().min(3).max(255), password: z.string().min(1).max(128), totpCode: z.string().optional() });

function sendSession(res: Response, r: Awaited<ReturnType<typeof auth.login>>, status = 200) {
  const csrfToken = setRefreshCookie(res, USER_RT, USER_AUTH_PATH, r.refreshToken, r.refreshExpiresAt);
  res.status(status).json({ user: r.user, accessToken: r.accessToken, csrfToken });
}

export async function register(req: Request, res: Response) {
  const body = parse(registerSchema, req.body);
  sendSession(res, await auth.register(body, clientInfo(req)), 201);
}

export async function login(req: Request, res: Response) {
  const body = parse(loginSchema, req.body);
  sendSession(res, await auth.login(body.identifier, body.password, body.totpCode, clientInfo(req)));
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[USER_RT];
  if (!token) throw new AppError('UNAUTHORIZED', 'No session');
  try {
    sendSession(res, await auth.refresh(token, clientInfo(req)));
  } catch (err) {
    clearRefreshCookie(res, USER_RT, USER_AUTH_PATH);
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[USER_RT];
  if (token) await auth.logout(token);
  clearRefreshCookie(res, USER_RT, USER_AUTH_PATH);
  res.status(204).end();
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = parse(z.object({ email: z.string().trim().email() }), req.body);
  await auth.forgotPassword(email);
  res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  const body = parse(z.object({ token: z.string().min(20).max(200), password: passwordSchema }), req.body);
  await auth.resetPassword(body.token, body.password);
  res.json({ ok: true });
}

export async function verifyEmail(req: Request, res: Response) {
  const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
  await auth.verifyEmail(token);
  res.json({ ok: true });
}

export async function resendVerification(req: Request, res: Response) {
  await auth.sendVerificationEmail(req.user!.id);
  res.json({ ok: true });
}
