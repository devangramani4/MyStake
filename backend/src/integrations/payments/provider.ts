import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Payment provider seam. Real PSPs (cards, UPI, bank transfer, e-wallets)
 * implement this interface; their webhooks call paymentService.completeDeposit
 * after signature verification. Card data never touches this platform.
 */
export interface DepositIntent {
  providerRef: string;
  /** 'COMPLETED' when the provider settles synchronously, otherwise the user is redirected / waits for a webhook. */
  status: 'PENDING' | 'COMPLETED';
  redirectUrl?: string;
  instructions?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createDeposit(p: { depositUuid: string; amount: string; currency: string }): Promise<DepositIntent>;
  /** Initiate a payout after admin approval. */
  payout(p: { withdrawalUuid: string; amount: string; currency: string }): Promise<{ providerRef: string; status: 'PROCESSING' | 'COMPLETED' }>;
}

/** DEVELOPMENT ONLY — completes deposits/payouts instantly. Refused in production. */
class MockProvider implements PaymentProvider {
  readonly name = 'mock';
  async createDeposit() { return { providerRef: `mock_${randomUUID()}`, status: 'COMPLETED' as const }; }
  async payout() { return { providerRef: `mock_po_${randomUUID()}`, status: 'COMPLETED' as const }; }
}

/** Manual bank transfer: deposits are confirmed by finance staff in the admin panel. */
class ManualProvider implements PaymentProvider {
  readonly name = 'manual';
  async createDeposit(p: { depositUuid: string }) {
    return { providerRef: `manual_${p.depositUuid.slice(0, 8)}`, status: 'PENDING' as const, instructions: `Use reference ${p.depositUuid.slice(0, 8).toUpperCase()} when transferring funds.` };
  }
  async payout(p: { withdrawalUuid: string }) { return { providerRef: `manual_po_${p.withdrawalUuid.slice(0, 8)}`, status: 'PROCESSING' as const }; }
}

export const paymentProvider: PaymentProvider = env.PAYMENT_PROVIDER === 'mock' ? new MockProvider() : new ManualProvider();
