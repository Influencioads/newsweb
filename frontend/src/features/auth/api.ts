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
