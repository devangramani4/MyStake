import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Wallet } from '../../types';
import { money, signedMoney } from '../../utils/format';

export function WalletCard({ wallet }: { wallet: Wallet }) {
  const pl = Number(wallet.profitLoss ?? 0);
  return (
    <section className="card wallet-hero stack" aria-label="Wallet summary">
      <div className="row between wrap">
        <div>
          <div className="stat-label">Available balance</div>
          <div className="big num">{money(wallet.balance, wallet.currency)}</div>
        </div>
        <div className="row">
          <Link to="/account/wallet/deposit" className="btn btn-primary"><ArrowDownLeft size={16} /> Deposit</Link>
          <Link to="/account/wallet/withdraw" className="btn btn-secondary"><ArrowUpRight size={16} /> Withdraw</Link>
        </div>
      </div>
      <div className="stats">
        <div className="stat card"><span className="stat-label">Exposure</span><span className="stat-value num">{money(wallet.exposure, wallet.currency)}</span></div>
        <div className="stat card"><span className="stat-label">Total balance</span><span className="stat-value num">{money(wallet.total, wallet.currency)}</span></div>
        <div className="stat card"><span className="stat-label">Profit / loss</span><span className={`stat-value num ${pl > 0 ? 'pos' : pl < 0 ? 'neg' : ''}`}>{signedMoney(pl, wallet.currency)}</span></div>
        <div className="stat card"><span className="stat-label">Pending bets</span><span className="stat-value num">{wallet.pendingBets ?? 0}</span></div>
      </div>
    </section>
  );
}
