import { api, setTokens, clearTokens } from '@/api/client';
import type { LoginResponse, Me, OtpRequestResponse, UserSession } from '@/types/auth';

export interface PasswordLoginInput {
  email: string;
  password: string;
  totp_code?: string;
  device_label?: string;
}

export async function loginWithPassword(input: PasswordLoginInput): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', {
    ...input,
    platform: 'cms',
    device_label: input.device_label ?? navigator.userAgent.slice(0, 120),
  });
  setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

export async function requestOtp(phone: string): Promise<OtpRequestResponse> {
  const { data } = await api.post<OtpRequestResponse>('/auth/otp/request', { phone });
  return data;
}

export async function verifyOtp(phone: string, otp: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/otp/verify', {
    phone,
    otp,
    platform: 'cms',
    device_label: navigator.userAgent.slice(0, 120),
  });
  setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

export async function fetchMe(): Promise<Me> {
  const { data } = await api.get<Me>('/auth/me');
  return data;
}

export async function fetchSessions(): Promise<UserSession[]> {
  const { data } = await api.get<UserSession[]>('/auth/sessions');
  return data;
}

export async function revokeSession(sessionId: number): Promise<void> {
  await api.delete(`/auth/sessions/${sessionId}`);
}

export async function logout(allDevices = false): Promise<void> {
  try {
    await api.post('/auth/logout', { all_devices: allDevices });
  } finally {
    // Clear locally even if the call failed — the user asked to sign out, and a
    // network error must not leave them looking signed in.
    clearTokens();
  }
}

// --- §4 reader accounts with email + password ------------------------------
export interface RegisterInput { name: string; email: string; password: string; confirm_password: string; phone?: string }

/** Creates a subscriber account and signs it in, exactly like the OTP flow. */
export async function registerReader(input: RegisterInput): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/register', {
    ...input,
    phone: input.phone || null,
    platform: 'web',
    device_label: navigator.userAgent.slice(0, 120),
  });
  setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

/** Reader password sign-in shares the staff endpoint; only the platform differs. */
export async function loginReader(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', {
    email, password, platform: 'web', device_label: navigator.userAgent.slice(0, 120),
  });
  setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

export const requestPasswordReset = async (email: string) =>
  (await api.post('/auth/password/reset-request', { email })).data;
export const confirmPasswordReset = async (token: string, newPassword: string) =>
  (await api.post('/auth/password/reset', { token, new_password: newPassword })).data;
export const verifyEmail = async (token: string) =>
  (await api.post('/auth/verify-email', { token })).data;
export const resendVerification = async () =>
  (await api.post('/auth/verify-email/resend')).data;
export const verifyPhone = async (phone: string, otp: string) =>
  (await api.post('/auth/verify-phone', { phone, otp, platform: 'web' })).data;

/** §5 profile picture. Multipart, so it bypasses the JSON default. */
export async function uploadAvatar(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return (await api.post('/users/me/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
}
export const updateProfile = async (payload: Record<string, unknown>) =>
  (await api.patch('/users/me', payload)).data;
