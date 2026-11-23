import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import App from './App';
import { getAccessToken } from './services/api/http';
import { socket } from './services/ws/socket';
import { store } from './store';
import { connectRealtime } from './store/realtime';
import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';

connectRealtime(store);
socket.setToken(getAccessToken());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
