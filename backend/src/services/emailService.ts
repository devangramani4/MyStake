import nodemailer from 'nodemailer';
import { env, isProd } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface Mail { to: string; subject: string; text: string; html?: string }

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined })
  : null;

/**
 * Dev mailbox: without SMTP in non-production, emails are kept in memory and
 * exposed at GET /api/dev/mailbox, so links containing tokens are never logged.
 */
export const devMailbox: Array<Mail & { at: string }> = [];

export async function sendMail(mail: Mail) {
  if (transport) {
    await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    logger.info({ email: { subject: mail.subject } }, 'email sent');
    return;
  }
  if (isProd) {
    logger.error({ email: { subject: mail.subject } }, 'SMTP not configured — email not sent');
    return;
  }
  devMailbox.unshift({ ...mail, at: new Date().toISOString() });
  devMailbox.length = Math.min(devMailbox.length, 50);
  logger.info({ email: { subject: mail.subject } }, 'email captured in dev mailbox (/api/dev/mailbox)');
}
