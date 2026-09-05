import { api, setTokens } from '@/api/client';
import type { LoginResponse } from '@/types/auth';
import type { DistrictOut, LocalityOut, MandalOut, StateOut } from '@/types/public';

/**
 * Reader account API (updated doc §11).
 *
 * OTP request reuses `/auth/otp/request`; verification goes to the reader
 * route, which registers a subscriber account on first use. Same token
 * machinery as staff — one session system for everyone.
 */

export interface ReaderLoginResponse extends LoginResponse {
  is_new_account: boolean;
}

export interface Preferences {
  language: 'te' | 'en';
  state: StateOut | null;
  district: DistrictOut | null;
  mandal: MandalOut | null;
  locality: LocalityOut | null;
  category_slugs: string[];
  notify_breaking: boolean;
  notify_local: boolean;
  notify_topics: boolean;
}

export interface PreferencesPatch {
  language?: 'te' | 'en';
  state_code?: string | null;
  district_slug?: string | null;
  mandal_slug?: string | null;
  locality_slug?: string | null;
  category_slugs?: string[];
  notify_breaking?: boolean;
  notify_local?: boolean;
  notify_topics?: boolean;
}

export async function verifyReaderOtp(phone: string, otp: string): Promise<ReaderLoginResponse> {
  const { data } = await api.post<ReaderLoginResponse>('/auth/reader/otp/verify', {
    phone,
    otp,
    platform: 'web',
    device_label: navigator.userAgent.slice(0, 120),
  });
  setTokens(data.tokens.access_token, data.tokens.refresh_token);
  return data;
}

export async function fetchPreferences(): Promise<Preferences> {
  const { data } = await api.get<Preferences>('/users/me/preferences');
  return data;
}

export async function updatePreferences(patch: PreferencesPatch): Promise<Preferences> {
  const { data } = await api.patch<Preferences>('/users/me/preferences', patch);
  return data;
}

export async function updateProfile(patch: {
  name_te?: string;
  name_en?: string;
}): Promise<void> {
  await api.patch('/users/me', patch);
}
