import { lazy, useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AccountLayout } from './layouts/AccountLayout';
import { MainLayout } from './layouts/MainLayout';
import { userApi } from './services/api/accountApi';
import { onSession } from './services/api/http';
import { socket } from './services/ws/socket';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { bootstrapSession, sessionEnded, userUpdated } from './store/slices/authSlice';
import { setExecutionMode, setUnread } from './store/slices/uiSlice';
import { contentApi } from './services/api/contentApi';
import { fetchWallet } from './store/slices/walletSlice';
import type { User } from './types';

// Route-level code splitting.
const HomePage = lazy(() => import('./pages/public/HomePage'));
const SportsPage = lazy(() => import('./pages/public/SportsPage'));
const SportPage = lazy(() => import('./pages/public/SportPage'));
const EventPage = lazy(() => import('./pages/public/EventPage'));
const LivePage = lazy(() => import('./pages/public/LivePage'));
const PromotionsPage = lazy(() => import('./pages/public/PromotionsPage'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmailPage'));
const InfoPage = lazy(() => import('./pages/info/InfoPage'));
const ContactPage = lazy(() => import('./pages/info/ContactPage'));
const DashboardPage = lazy(() => import('./pages/account/DashboardPage'));
const MyBetsPage = lazy(() => import('./pages/account/MyBetsPage'));
const WalletPage = lazy(() => import('./pages/account/WalletPage'));
const DepositPage = lazy(() => import('./pages/account/DepositPage'));
const WithdrawPage = lazy(() => import('./pages/account/WithdrawPage'));
const TransactionsPage = lazy(() => import('./pages/account/TransactionsPage'));
const ProfilePage = lazy(() => import('./pages/account/ProfilePage'));
const SecurityPage = lazy(() => import('./pages/account/SecurityPage'));
const NotificationsPage = lazy(() => import('./pages/account/NotificationsPage'));
const LimitsPage = lazy(() => import('./pages/account/LimitsPage'));
const NotFoundPage = lazy(() => import('./pages/info/NotFoundPage'));

const router = createBrowserRouter([
  {
    element: <MainLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/sports', element: <SportsPage /> },
      { path: '/sports/:sport', element: <SportPage /> },
      { path: '/event/:eventId', element: <EventPage /> },
      { path: '/live', element: <LivePage /> },
      { path: '/promotions', element: <PromotionsPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/terms', element: <InfoPage doc="terms" /> },
      { path: '/privacy', element: <InfoPage doc="privacy" /> },
      { path: '/responsible-gambling', element: <InfoPage doc="responsible" /> },
      { path: '/contact', element: <ContactPage /> },
      {
        path: '/account',
        element: <AccountLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'bets', element: <MyBetsPage /> },
          { path: 'wallet', element: <WalletPage /> },
          { path: 'wallet/deposit', element: <DepositPage /> },
          { path: 'wallet/withdraw', element: <WithdrawPage /> },
          { path: 'transactions', element: <TransactionsPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'security', element: <SecurityPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'responsible-gambling', element: <LimitsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export default function App() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);

  useEffect(() => {
    onSession(({ accessToken, user }) => {
      socket.setToken(accessToken);
      if (!accessToken) dispatch(sessionEnded());
      else if (user) dispatch(userUpdated(user as User));
    });
    void dispatch(bootstrapSession());
    contentApi.config().then((c) => dispatch(setExecutionMode(c.executionMode))).catch(() => undefined);
  }, [dispatch]);

  useEffect(() => {
    if (status !== 'authenticated') {
      socket.setToken(null);
      return;
    }
    void dispatch(fetchWallet());
    userApi.notifications(1).then((n) => dispatch(setUnread(n.unread))).catch(() => undefined);
  }, [status, dispatch]);

  return <RouterProvider router={router} />;
}
