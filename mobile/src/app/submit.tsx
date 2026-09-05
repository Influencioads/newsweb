import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { api, ApiError } from '@/api/client';
import { EmptyState } from '@/components/Feedback';
import { timeAgo, useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { useAuth } from '@/stores/auth';

/** Creator submissions (§17): write → accept guidelines → moderation. */

type SubmissionStatus = 'pending' | 'approved' | 'rejected';
interface Submission {
  id: number;
  title_te: string;
  status: SubmissionStatus;
  review_note: string | null;
  created_at: string;
}

export default function SubmitScreen() {
  const { t, language, isTelugu } = useI18n();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: ['my-submissions'],
    queryFn: async () => (await api.get<Submission[]>('/users/me/submissions')).data,
    enabled: authed,
  });

  const submit = useMutation({
    mutationFn: async () =>
      (
        await api.post('/users/me/submissions', {
          title_te: title.trim(),
          body_te: body.trim(),
          accept_guidelines: accepted,
        })
      ).data,
    onSuccess: () => {
      setTitle('');
      setBody('');
      setAccepted(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? (isTelugu ? e.messageTe : e.messageEn) : String(e)),
  });

  const canSubmit = title.trim().length >= 10 && body.trim().length >= 100 && accepted;
  const STATUS_LABEL: Record<SubmissionStatus, string> = {
    pending: t('submit.pending'),
    approved: t('submit.approved'),
    rejected: t('submit.rejected'),
  };
  const STATUS_COLOR: Record<SubmissionStatus, string> = {
    pending: color.exclusive,
    approved: color.success,
    rejected: color.breaking,
  };

  return (
    <>
      <Stack.Screen options={{ title: t('submit.title') }} />
      {!authed ? (
        <EmptyState message={t('comments.signIn')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.hint}>{t('submit.hint')}</Text>

          <Text style={styles.label}>{t('submit.headline')} *</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            placeholder="ఉదా: మా ఊరి యువత కట్టిన గ్రంథాలయం"
            placeholderTextColor={color.mutedLight}
            style={styles.input}
          />

          <Text style={styles.label}>{t('submit.body')} *</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
            maxLength={20000}
            placeholder="పూర్తి వివరాలతో రాయండి…"
            placeholderTextColor={color.mutedLight}
            style={[styles.input, styles.bodyInput]}
          />
          <Text style={styles.counter}>{body.length}/20000</Text>

          <View style={styles.guidelineRow}>
            <Switch
              value={accepted}
              onValueChange={setAccepted}
              trackColor={{ true: color.brand, false: color.ruleStrong }}
              thumbColor={color.white}
            />
            <Text style={styles.guidelineText}>{t('submit.guidelines')}</Text>
          </View>

          <Pressable
            onPress={() => submit.mutate()}
            disabled={!canSubmit || submit.isPending}
            accessibilityRole="button"
            style={[styles.button, (!canSubmit || submit.isPending) && styles.disabled]}
          >
            <Text style={styles.buttonText}>
              {submit.isPending ? t('submit.sending') : t('submit.send')}
            </Text>
          </Pressable>
          {submit.isSuccess ? <Text style={styles.success}>{t('submit.received')}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.mineTitle}>{t('submit.mine')}</Text>
          {mine.data?.length ? (
            mine.data.map((s) => (
              <View key={s.id} style={styles.mineRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.mineHeadline}>{s.title_te}</Text>
                  {s.review_note ? (
                    <Text style={styles.mineNote}>గమనిక: {s.review_note}</Text>
                  ) : null}
                  <Text style={styles.mineTime}>{timeAgo(s.created_at, language)}</Text>
                </View>
                <Text style={[styles.mineStatus, { color: STATUS_COLOR[s.status] }]}>
                  {STATUS_LABEL[s.status]}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.mineEmpty}>—</Text>
          )}
          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16 },
  hint: { fontFamily: font.telugu, fontSize: 13, lineHeight: 22, color: color.muted, marginBottom: 12 },
  label: {
    fontFamily: font.teluguSemiBold,
    fontSize: 12.5,
    lineHeight: 19,
    color: color.ink,
    marginBottom: 4,
    marginTop: 10,
  },
  input: {
    borderWidth: 1.5,
    borderColor: color.ruleStrong,
    borderRadius: 8,
    backgroundColor: color.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: font.telugu,
    fontSize: 15.5,
    lineHeight: 24,
    color: color.ink,
  },
  bodyInput: { minHeight: 220 },
  counter: {
    fontFamily: font.telugu,
    fontSize: 10,
    color: color.mutedLight,
    textAlign: 'right',
    marginTop: 2,
  },
  guidelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  guidelineText: {
    flex: 1,
    fontFamily: font.telugu,
    fontSize: 12.5,
    lineHeight: 21,
    color: color.ink,
  },
  button: {
    marginTop: 16,
    backgroundColor: color.brand,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  buttonText: { fontFamily: font.teluguBold, fontSize: 15, lineHeight: 23, color: color.white },
  success: {
    fontFamily: font.teluguSemiBold,
    fontSize: 12.5,
    lineHeight: 20,
    color: color.success,
    textAlign: 'center',
    marginTop: 8,
  },
  error: {
    fontFamily: font.telugu,
    fontSize: 13,
    lineHeight: 21,
    color: color.breaking,
    backgroundColor: '#FDECEC',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
  },
  mineTitle: {
    fontFamily: font.teluguBold,
    fontSize: 16,
    lineHeight: 25,
    color: color.brand,
    marginTop: 24,
    marginBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: color.ink,
    paddingBottom: 4,
  },
  mineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },
  mineHeadline: { fontFamily: font.teluguSemiBold, fontSize: 14, lineHeight: 23, color: color.ink },
  mineNote: { fontFamily: font.telugu, fontSize: 12, lineHeight: 19, color: color.muted, marginTop: 2 },
  mineTime: { fontFamily: font.telugu, fontSize: 10.5, lineHeight: 16, color: color.mutedLight, marginTop: 2 },
  mineStatus: { fontFamily: font.teluguBold, fontSize: 11.5, lineHeight: 18 },
  mineEmpty: { fontFamily: font.telugu, fontSize: 13, color: color.mutedLight },
});
