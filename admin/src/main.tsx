import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@shared-styles/tokens.css';
import '@shared-styles/global.css';
import '@shared-styles/components.css';
import './admin.css';
import App from './App';
import { AuthProvider } from './auth';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
