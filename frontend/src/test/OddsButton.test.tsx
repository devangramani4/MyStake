import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { OddsButton } from '../components/betting/OddsButton';
import { makeStore } from '../store';
import { booksReceived } from '../store/slices/marketsSlice';
import type { MarketBook } from '../types';

const book = (status: MarketBook['status'], price = 1.85, updatedAt = 1): MarketBook => ({
  marketId: '1.1', status, inPlay: false, betDelay: 0, totalMatched: 0, version: 1, updatedAt,
  runners: [{ selectionId: 7, status: 'ACTIVE', lastPriceTraded: null, totalMatched: 0, back: [{ price, size: 5000 }], lay: [{ price: 1.9, size: 3500 }] }],
});
const ctx = { eventId: '9', eventName: 'India v Australia', marketName: 'Match Odds', selectionName: 'India' };

describe('OddsButton', () => {
  it('shows the live price, adds to the slip on click and disables when suspended', () => {
    const store = makeStore();
    store.dispatch(booksReceived([book('OPEN')]));
    render(<Provider store={store}><OddsButton marketId="1.1" selectionId={7} side="BACK" ctx={ctx} /></Provider>);
    const btn = screen.getByRole('button', { name: /Back India at 1.85/ });
    fireEvent.click(btn);
    expect(store.getState().betslip.selections[0]).toMatchObject({ side: 'BACK', price: 1.85, selectionName: 'India' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');

    act(() => { store.dispatch(booksReceived([book('OPEN', 1.8, 2)])); });
    expect(screen.getByRole('button', { name: /Back India at 1.80/ })).toHaveClass('flash-down');

    act(() => { store.dispatch(booksReceived([book('SUSPENDED', 1.8, 3)])); });
    expect(screen.getByRole('button', { name: /Back India/ })).toBeDisabled();
  });
});
