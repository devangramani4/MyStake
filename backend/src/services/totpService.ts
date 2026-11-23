import { generateSecret, generateURI, verify } from 'otplib';
import { env } from '../config/env.js';
import { decrypt, encrypt } from '../utils/crypto.js';

/** TOTP (RFC 6238) 2FA. Secrets are AES-GCM encrypted at rest. */
export function newTotpSecret(label: string) {
  const secret = generateSecret();
  return { secret, encrypted: encrypt(secret), otpauthUrl: generateURI({ issuer: env.APP_NAME, label, secret }) };
}

export async function verifyTotp(encryptedSecret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const res = await verify({ secret: decrypt(encryptedSecret), token: code, epochTolerance: 30 });
  return res.valid;
}
