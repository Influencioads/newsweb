import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * API client — the mobile twin of frontend/src/api/client.ts.
 *
 *  - attaches the access token
 *  - transparently refreshes once on 401 and replays the request
 *  - normalises the backend error envelope into `ApiError` (te + en messages)
 *
 * Tokens live in SecureStore (Keychain/Keystore), mirrored in memory so the
 * request interceptor stays synchronous after bootstrap.
 */

// ---------------------------------------------------------------- base URL --
// EXPO_PUBLIC_API_URL wins (set it for staging/production builds). In Expo Go
// on a device, "localhost" is the phone — derive the dev machine's LAN address
// from the Metro host instead so the app talks to the laptop's backend.
function resolveApiOrigin(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  // Tolerate the version suffix being included by mistake: this is an *origin*,
  // and `/api/v1` is appended below. A build that carried it twice 404'd every
  // request, so strip it rather than trust the value.
  if (explicit) return explicit.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  const hostUri: string | undefined = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  if (host && Platform.OS !== 'web') return `http://${host}:8000`;
  return 'http://localhost:8000';
}

export const API_ORIGIN = resolveApiOrigin();
export const API_BASE = `${API_ORIGIN}/api/v1`;

/** Media URLs from the dev backend are host-relative or localhost-absolute —
 * rewrite them so a phone on the LAN loads them from the dev machine. */
export function absoluteMediaUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return `${API_ORIGIN}${url}`;
  return url.replace(/^http:\/\/(localhost|127\.0\.0\.1):8000/, API_ORIGIN);
}

// ------------------------------------------------------------------ errors --
export interface ApiErrorPayload {
  code: string;
  message_en: string;
  message_te: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly messageEn: string;
  readonly messageTe: string;
  readonly status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message_en);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.messageEn = payload.message_en;
    this.messageTe = payload.message_te;
  }
}

const NETWORK_ERROR: ApiErrorPayload = {
  code: 'NETWORK_ERROR',
  message_en: 'Could not reach the server. Check your connection.',
  message_te: 'సర్వర్‌ను చేరుకోలేకపోయాం. మీ ఇంటర్నెట్ కనెక్షన్ చూడండి.',
};

// ------------------------------------------------------------------ tokens --
const ACCESS_KEY = 'tn.access_token';
const REFRESH_KEY = 'tn.refresh_token';

let accessToken: string | null = null;
let refreshToken: string | null = null;

// SecureStore is unavailable on react-native-web; fall back to localStorage.
const store = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string | null): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        if (value) globalThis.localStorage?.setItem(key, value);
        else globalThis.localStorage?.removeItem(key);
      } catch {
        /* private mode */
      }
      return;
    }
    if (value) await SecureStore.setItemAsync(key, value);
    else await SecureStore.deleteItemAsync(key);
  },
};

/** Load persisted tokens into memory. Call once before the first request. */
export async function loadTokens(): Promise<boolean> {
  [accessToken, refreshToken] = await Promise.all([store.get(ACCESS_KEY), store.get(REFRESH_KEY)]);
  return Boolean(accessToken || refreshToken);
}

export async function setTokens(access: string | null, refresh: string | null): Promise<void> {
  accessToken = access;
  refreshToken = refresh;
  await Promise.all([store.set(ACCESS_KEY, access), store.set(REFRESH_KEY, refresh)]);
}

export async function clearTokens(): Promise<void> {
  await setTokens(null, null);
}

export function hasSession(): boolean {
  return Boolean(refreshToken);
}

// ------------------------------------------------------------------ client --
export const api = axios.create({
  baseURL: API_BASE,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(fn: (() => void) | null): void {
  onAuthFailure = fn;
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<{ access_token: string; refresh_token: string }>(
      `${API_BASE}/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { 'Content-Type': 'application/json' } },
    );
    await setTokens(data.access_token, data.refresh_token);
    return data.access_token;
  } catch {
    await clearTokens();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: ApiErrorPayload }>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (!error.response) {
      return Promise.reject(new ApiError(0, NETWORK_ERROR));
    }

    const status = error.response.status;
    const isRefreshCall = original?.url?.includes('/auth/refresh');
    if (status === 401 && original && !original._retried && !isRefreshCall && refreshToken) {
      original._retried = true;
      refreshInFlight ??= refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });
      const newToken = await refreshInFlight;
      if (newToken) {
        original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
        return api.request(original);
      }
      onAuthFailure?.();
    }

    const payload = error.response.data?.error;
    return Promise.reject(
      new ApiError(
        status,
        payload ?? {
          code: `HTTP_${status}`,
          message_en: 'Request failed.',
          message_te: 'అభ్యర్థన విఫలమైంది.',
        },
      ),
    );
  },
);
