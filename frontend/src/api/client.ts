import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

/**
 * Single axios instance for the whole app.
 *
 * Responsibilities:
 *  - attach the access token
 *  - transparently refresh once on 401 and replay the original request
 *  - normalise every backend error into `ApiError`, which carries both the
 *    English and Telugu message the API returned (§13 error envelope)
 *
 * Tokens live in memory + localStorage, never in a cookie readable by JS from
 * another origin. The refresh token is rotated by the server on every use (§1).
 */

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
  readonly details: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message_en);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.messageEn = payload.message_en;
    this.messageTe = payload.message_te;
    this.details = payload.details ?? {};
  }

  /** Telugu first — this is a Telugu-first product (§49). */
  get displayMessage(): string {
    return this.messageTe || this.messageEn;
  }
}

const NETWORK_ERROR: ApiErrorPayload = {
  code: 'NETWORK_ERROR',
  message_en: 'Could not reach the server. Check your connection.',
  message_te: 'సర్వర్‌ను చేరుకోలేకపోయాం. మీ ఇంటర్నెట్ కనెక్షన్ చూడండి.',
};

export const TOKEN_STORAGE_KEY = 'tn.access_token';
export const REFRESH_STORAGE_KEY = 'tn.refresh_token';

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  try {
    accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    accessToken = null;
  }
  return accessToken;
}

export function setTokens(access: string | null, refresh?: string | null): void {
  accessToken = access;
  try {
    if (access) localStorage.setItem(TOKEN_STORAGE_KEY, access);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
    if (refresh !== undefined) {
      if (refresh) localStorage.setItem(REFRESH_STORAGE_KEY, refresh);
      else localStorage.removeItem(REFRESH_STORAGE_KEY);
    }
  } catch {
    /* private mode — in-memory token still works for this tab */
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  setTokens(null, null);
}

export const API_BASE = '/api/v1';

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Callback the auth store registers so a failed refresh can log the user out. */
let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(fn: (() => void) | null): void {
  onAuthFailure = fn;
}

// A single in-flight refresh shared by every queued request, so ten parallel
// 401s cause one refresh call rather than ten competing rotations.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const { data } = await axios.post<{ access_token: string; refresh_token: string }>(
      `${API_BASE}/auth/refresh`,
      { refresh_token: refresh },
      { headers: { 'Content-Type': 'application/json' } },
    );
    setTokens(data.access_token, data.refresh_token);
    return data.access_token;
  } catch {
    clearTokens();
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
    const payload = error.response.data?.error;

    // One refresh attempt, and never for the refresh endpoint itself.
    const isRefreshCall = original?.url?.includes('/auth/refresh');
    if (status === 401 && original && !original._retried && !isRefreshCall && getRefreshToken()) {
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
