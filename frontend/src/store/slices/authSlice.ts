import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { authApi } from '../../services/api/authApi';
import { bootstrapCsrfFromCookie, refreshSession, setAccessToken, setCsrfToken } from '../../services/api/http';
import type { User } from '../../types';
import { toAppError, type AppErrorInfo } from '../../utils/errors';

interface AuthState {
  user: User | null;
  status: 'unknown' | 'authenticated' | 'anonymous';
}

const initialState: AuthState = { user: null, status: 'unknown' };

/** Try to resume a session from the httpOnly refresh cookie. */
export const bootstrapSession = createAsyncThunk('auth/bootstrap', async () => {
  // No CSRF cookie → no prior session; skip the refresh round-trip.
  if (!bootstrapCsrfFromCookie()) return null;
  const token = await refreshSession();
  if (!token) return null;
  return authApi.me();
});

/** Thunks reject with a serialisable AppErrorInfo ({ code, message, details }). */
export const login = createAsyncThunk<User, { identifier: string; password: string; totpCode?: string }, { rejectValue: AppErrorInfo }>('auth/login', async (p, { rejectWithValue }) => {
  try {
    return (await authApi.login(p.identifier, p.password, p.totpCode)).user;
  } catch (e) {
    return rejectWithValue(toAppError(e));
  }
});
export const register = createAsyncThunk<User, Record<string, unknown>, { rejectValue: AppErrorInfo }>('auth/register', async (body, { rejectWithValue }) => {
  try {
    return (await authApi.register(body)).user;
  } catch (e) {
    return rejectWithValue(toAppError(e));
  }
});

export const logout = createAsyncThunk('auth/logout', async () => {
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  try {
    await authApi.logout(m ? decodeURIComponent(m[1]) : null);
  } finally {
    setAccessToken(null);
    setCsrfToken(null);
  }
});

const slice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    userUpdated(state, a: PayloadAction<User>) {
      state.user = a.payload;
    },
    sessionEnded(state) {
      state.user = null;
      state.status = 'anonymous';
    },
  },
  extraReducers: (b) => {
    b.addCase(bootstrapSession.fulfilled, (s, a) => {
      s.user = a.payload;
      s.status = a.payload ? 'authenticated' : 'anonymous';
    });
    b.addCase(bootstrapSession.rejected, (s) => {
      s.status = 'anonymous';
    });
    b.addCase(login.fulfilled, (s, a) => {
      s.user = a.payload;
      s.status = 'authenticated';
    });
    b.addCase(register.fulfilled, (s, a) => {
      s.user = a.payload;
      s.status = 'authenticated';
    });
    b.addCase(logout.fulfilled, (s) => {
      s.user = null;
      s.status = 'anonymous';
    });
    b.addCase(logout.rejected, (s) => {
      s.user = null;
      s.status = 'anonymous';
    });
  },
});

export const { userUpdated, sessionEnded } = slice.actions;
export default slice.reducer;
