import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { SwitchRow } from '@/components/profile/SettingsRows';
import { timeAgo, useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { ConfirmSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Field, Input } from '@/ui/Input';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/** Creator submissions (§17): write → accept guidelines → moderation. */
type SubmissionStatus = 'pending' | 'approved' | 'rejected';
interface Submission {
  id: number;
  title_te: string;
  status: SubmissionStatus;
  review_note: string | null;
  created_at: string;
}

// ponytail: no i18n keys yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

const TITLE_MIN = 10;
const BODY_MIN = 100;
const BODY_MAX = 20000;

const STATUS_TONE: Record<SubmissionStatus, BadgeTone> = {
  pending: 'exclusive',
  approved: 'success',
  rejected: 'breaking',
};

export default function SubmitScreen() {
  const styles = useStyles();
  const { t, language, isTelugu } = useI18n();
  const toast = useToast();
  const authed = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

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
      setTouched(false);
      toast.success(t('submit.received'));
      void queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
    },
    onError: (e) => toast.error(e),
  });

  const titleOk = title.trim().length >= TITLE_MIN;
  const bodyOk = body.trim().length >= BODY_MIN;
  const canSubmit = titleOk && bodyOk && accepted && !submit.isPending;
  const hasDraft = title.length > 0 || body.length > 0;

  const STATUS_LABEL: Record<SubmissionStatus, string> = {
    pending: t('submit.pending'),
    approved: t('submit.approved'),
    rejected: t('submit.rejected'),
  };

  if (!authed) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: t('submit.title') }} />
        <EmptyState icon="logIn" title={t('ui.signInToContinue')} body={t('comments.signIn')} />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']} scroll keyboard contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: t('submit.title') }} />

      <T variant="bodySmall" color="muted" scaled>
        {t('submit.hint')}
      </T>

      {/* The route into citizen journalism proper: verified contributors
          may send more, attach photographs, and carry a verified byline. */}
      <Button
        variant="ghost"
        iconRight="arrowRight"
        label={L('విలేకరిగా ధృవీకరించుకోండి', 'Get verified as a contributor', isTelugu)}
        onPress={() => router.push('/contributor')}
        style={styles.link}
      />

      <Field
        label={t('submit.headline')}
        required
        error={
          touched && !titleOk
            ? L(
                `కనీసం ${TITLE_MIN} అక్షరాల శీర్షిక రాయండి.`,
                `Write a headline of at least ${TITLE_MIN} characters.`,
                isTelugu,
              )
            : undefined
        }
      >
        <Input
          value={title}
          onChangeText={setTitle}
          onBlur={() => setTouched(true)}
          maxLength={200}
          placeholder={L(
            'ఉదా: మా ఊరి యువత కట్టిన గ్రంథాలయం',
            'e.g. The library our village youth built',
            isTelugu,
          )}
        />
      </Field>

      <Field
        label={t('submit.body')}
        required
        error={
          touched && !bodyOk
            ? L(
                `కనీసం ${BODY_MIN} అక్షరాలు రాయండి.`,
                `Write at least ${BODY_MIN} characters.`,
                isTelugu,
              )
            : undefined
        }
        style={styles.field}
      >
        <Input
          value={body}
          onChangeText={setBody}
          onBlur={() => setTouched(true)}
          multiline
          counter={BODY_MAX}
          placeholder={L('పూర్తి వివరాలతో రాయండి…', 'Write the full story…', isTelugu)}
        />
      </Field>

      <Card padding="none" style={styles.guidelines}>
        <SwitchRow
          label={t('submit.guidelines')}
          value={accepted}
          onChange={setAccepted}
          icon="shield"
        />
      </Card>

      <View style={styles.actions}>
        <Button
          label={submit.isPending ? t('submit.sending') : t('submit.send')}
          icon="send"
          pending={submit.isPending}
          disabled={!canSubmit}
          onPress={() => submit.mutate()}
          style={styles.grow}
        />
        {hasDraft ? (
          <Button
            label={t('ui.clear')}
            variant="secondary"
            icon="trash2"
            onPress={() => setConfirmClear(true)}
          />
        ) : null}
      </View>

      <T variant="headlineMd" weight="bold" style={styles.mineTitle} accessibilityRole="header">
        {t('submit.mine')}
      </T>

      {mine.isLoading ? <LoadingState variant="list" rows={3} /> : null}
      {mine.isError ? (
        <ErrorState error={mine.error} fill={false} onRetry={() => void mine.refetch()} />
      ) : null}
      {mine.data && mine.data.length === 0 ? (
        <EmptyState
          icon="fileText"
          body={L(
            'ఇంకా సమర్పణలు లేవు. పైన మీ మొదటి కథనం రాయండి.',
            'No submissions yet — write your first story above.',
            isTelugu,
          )}
        />
      ) : null}

      {(mine.data ?? []).map((s) => (
        <Card key={s.id} style={styles.row}>
          <View style={styles.rowText}>
            <T variant="body" weight="semibold" lang="te" scaled numberOfLines={3}>
              {s.title_te}
            </T>
            {s.review_note ? (
              <T variant="bodySmall" color="muted" lang="te" scaled>
                {`${L('గమనిక', 'Note', isTelugu)}: ${s.review_note}`}
              </T>
            ) : null}
            <T variant="meta" color="muted">
              {timeAgo(s.created_at, language)}
            </T>
          </View>
          <Badge tone={STATUS_TONE[s.status]} size="xs" label={STATUS_LABEL[s.status]} />
        </Card>
      ))}

      <ConfirmSheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={L('రాసినది తొలగించాలా?', 'Clear this draft?', isTelugu)}
        body={L(
          'మీరు రాసిన శీర్షిక, కథనం పోతాయి. దీన్ని వెనక్కి తీసుకోలేరు.',
          'Your headline and story will be lost. This cannot be undone.',
          isTelugu,
        )}
        confirmLabel={t('ui.delete')}
        tone="danger"
        onConfirm={() => {
          setTitle('');
          setBody('');
          setTouched(false);
          setConfirmClear(false);
          toast.info(t('state.deleted'));
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  body: { padding: space.lg, paddingBottom: space.xxl, gap: space.sm },
  link: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  field: { marginTop: space.sm },
  guidelines: { marginTop: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  grow: { flex: 1 },
  mineTitle: { marginTop: space.xl },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginTop: space.sm },
  rowText: { flex: 1, minWidth: 0, gap: space.xs },
}));
