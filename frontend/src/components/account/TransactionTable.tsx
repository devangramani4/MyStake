import type { Transaction } from '../../types';
import { dateTime, money, signedMoney } from '../../utils/format';

const LABEL: Record<Transaction['type'], string> = { DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal', BET: 'Bet', WIN: 'Win', LOSS: 'Loss', REFUND: 'Refund', COMMISSION: 'Commission', ADJUSTMENT: 'Adjustment' };

/** Ledger view: `amount` changes available balance; exposure moves are shown separately. */
export function TransactionTable({ items }: { items: Transaction[] }) {
  return (
    <div className="table-wrap responsive">
      <table className="table">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Description</th><th className="r">Amount</th><th className="r">Exposure</th><th className="r">Balance</th></tr>
        </thead>
        <tbody>
          {items.map((t) => {
            const a = Number(t.amount);
            const ex = Number(t.exposureChange);
            return (
              <tr key={t.id}>
                <td className="muted">{dateTime(t.createdAt)}</td>
                <td><span className="badge">{LABEL[t.type]}</span></td>
                <td className="muted">{t.description ?? '—'}</td>
                <td className={`r num ${a > 0 ? 'pos' : a < 0 ? 'neg' : ''}`}>{signedMoney(a)}</td>
                <td className="r num muted">{ex ? signedMoney(ex) : '—'}</td>
                <td className="r num">{money(t.balanceAfter)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mobile-cards">
        {items.map((t) => (
          <div className="mcard" key={t.id}>
            <div className="row between"><span className="badge">{LABEL[t.type]}</span><b className={`num ${Number(t.amount) > 0 ? 'pos' : Number(t.amount) < 0 ? 'neg' : ''}`}>{signedMoney(t.amount)}</b></div>
            <div className="muted" style={{ fontSize: 12 }}>{t.description}</div>
            <div className="kv"><span className="faint">{dateTime(t.createdAt)}</span><span className="num">Bal {money(t.balanceAfter)}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
