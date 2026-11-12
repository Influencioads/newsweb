import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { api, API_BASE, setTokens } from './client';
import type { Me, OtpRequestResponse, Preferences, PreferencesPatch, ReaderLoginResponse } from './types';

export async function requestOtp(phone: string): Promise<OtpRequestResponse> {
  const { data } = await api.post<OtpRequestResponse>('/auth/otp/request', { phone });
  return data;
}

export async function verifyReaderOtp(phone: string, otp: string): Promise<ReaderLoginResponse> {
  const { data } = await api.post<ReaderLoginResponse>('/auth/reader/otp/verify', {
    phone,
    otp,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    device_label: `${Platform.OS} app`,
  });
  await setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

export async function fetchMe(): Promise<Me> {
  const { data } = await api.get<Me>('/auth/me');
  return data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', { all_devices: false });
  } catch {
    // Clearing locally regardless — the user asked to sign out.
  }
}

export async function fetchPreferences(): Promise<Preferences> {
  const { data } = await api.get<Preferences>('/users/me/preferences');
  return data;
}

export async function updatePreferences(patch: PreferencesPatch): Promise<Preferences> {
  const { data } = await api.patch<Preferences>('/users/me/preferences', patch);
  return data;
}

// --- §4 email accounts -----------------------------------------------------
export interface RegisterInput { name: string; email: string; password: string; confirm_password: string; phone?: string }

/** Signup returns the same envelope as OTP verification, so the caller's
 *  post-login path is identical. */
export async function registerReader(input: RegisterInput): Promise<ReaderLoginResponse> {
  const { data } = await api.post<ReaderLoginResponse>('/auth/register', {
    ...input,
    phone: input.phone || null,
    platform: 'android',
  });
  await setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

export async function loginWithPassword(email: string, password: string): Promise<ReaderLoginResponse> {
  const { data } = await api.post<ReaderLoginResponse>('/auth/login', {
    email, password, platform: 'android',
  });
  await setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

export const requestPasswordReset = async (email: string) =>
  (await api.post('/auth/password/reset-request', { email })).data;
export const resendVerification = async () =>
  (await api.post('/auth/verify-email/resend')).data;

/** §5 profile picture. */
export async function uploadAvatar(uri: string, name = 'avatar.jpg', type = 'image/jpeg') {
  const form = new FormData();
  // React Native's FormData takes this shape rather than a File.
  form.append('file', { uri, name, type } as unknown as Blob);
  return (await api.post('/users/me/avatar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })).data;
}

// --- Sign in with Google -----------------------------------------------------
/** Where the server sends the browser back to (app.json `scheme`). */
const GOOGLE_RETURN = 'wowindian://auth';

/**
 * Sign in with Google through the server's flow (backend
 * app/services/google_auth_service): a browser sheet opens Google, the server
 * sends it back to wowindian://auth with a one-use ticket, and the ticket is
 * swapped for tokens here. Returns null when the reader closes the sheet;
 * throws an Error whose message is the server's reason (not_staff, ...).
 */
export async function signInWithGoogle(): Promise<ReaderLoginResponse | null> {
  const result = await WebBrowser.openAuthSessionAsync(`${API_BASE}/auth/google/start?target=app`, GOOGLE_RETURN);
  if (result.type !== 'success') return null;
  const params = new URL(result.url.replace(GOOGLE_RETURN, 'https://app.invalid/auth')).searchParams;
  const ticket = params.get('ticket');
  if (!ticket) throw new Error(params.get('error') || 'failed');
  const { data } = await api.post<ReaderLoginResponse>('/auth/google/exchange', {
    ticket,
    device_label: `${Platform.OS} app`,
  });
  await setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}
