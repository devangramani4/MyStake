import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { BetSlip } from '../components/betting/BetSlip';
import { BottomNav } from '../components/layout/BottomNav';
import { ConnectionBanner } from '../components/layout/ConnectionBanner';
import { Footer } from '../components/layout/Footer';
import { Header } from '../components/layout/Header';
import { Logo } from '../components/layout/Logo';
import { Sidebar } from '../components/layout/Sidebar';
import { SportsMenu } from '../components/sports/SportsMenu';
import { Drawer } from '../components/ui/Drawer';
import { LoadingSkeleton } from '../components/ui/States';
import { Toaster } from '../components/ui/Toast';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setSlipOpen } from '../store/slices/betslipSlice';
import { setNavOpen } from '../store/slices/uiSlice';

/**
 * Desktop: Header / Sidebar / Main / Bet slip.
 * Tablet: Header / Main / Bet slip (sports menu in a drawer).
 * Phone: Header / Main / bottom nav with the bet slip as a bottom sheet.
 */
export function MainLayout() {
  const dispatch = useAppDispatch();
  const navOpen = useAppSelector((s) => s.ui.navOpen);
  const slipOpen = useAppSelector((s) => s.betslip.open);
  const isPhone = useMediaQuery('(max-width: 860px)');
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    dispatch(setNavOpen(false));
  }, [pathname, dispatch]);

  return (
    <div className="shell">
      <a href="#main" className="sr-only">Skip to content</a>
      <Header />
      <div>
        <ConnectionBanner />
        <div className="body">
          <Sidebar />
          <main id="main" className="main">
            <Suspense fallback={<div className="page"><LoadingSkeleton rows={6} /></div>}>
              <Outlet />
            </Suspense>
            <Footer />
          </main>
          {!isPhone && <aside className="slip-col" aria-label="Bet slip"><BetSlip /></aside>}
        </div>
      </div>
      <BottomNav />
      <Drawer open={navOpen} onClose={() => dispatch(setNavOpen(false))} side="left" label="Menu">
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}><Logo /></div>
        <div style={{ padding: 12, overflowY: 'auto' }}><SportsMenu onNavigate={() => dispatch(setNavOpen(false))} /></div>
      </Drawer>
      {isPhone && (
        <Drawer open={slipOpen} onClose={() => dispatch(setSlipOpen(false))} side="bottom" label="Bet slip">
          <BetSlip />
        </Drawer>
      )}
      <Toaster />
    </div>
  );
}
