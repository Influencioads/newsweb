import { Platform } from 'react-native';

import { api, setTokens } from './client';
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
