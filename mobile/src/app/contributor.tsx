import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api/client';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { Badge } from '@/ui/Badge';
import { ConfirmSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Icon } from '@/ui/Icon';
import { Field, Input } from '@/ui/Input';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * Applying to be a contributor, from the phone.
 *
 * Most citizen journalists will only ever do this on a phone, with the ID card
 * in their hand — so the document step is a camera button, not a file picker.
 *
 * The paragraph above the upload is deliberately plain and deliberately first:
 * somebody is about to photograph their PAN card, and they should know where
 * it goes before they do, not afterwards in a policy page.
 *
 * The type/name fields are *derived* from the loaded application until the
 * reader edits them (`typeEdit ?? data.contributor_type`), rather than copied
 * into state by an effect — the effect version cascaded a render on every
 * refetch and tripped `react-hooks/set-state-in-effect`.
 */
type Status =
  | 'not_started'
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'more_info'
  | 'approved'
  | 'rejected'
  | 'expired';

interface DocumentRow {
  id: number;
  kind: string;
  number_masked: string | null;
}

interface Application {
  id?: number;
  status: Status;
  contributor_type: string | null;
  display_name_te?: string;
  review_note?: string | null;
  documents: DocumentRow[];
  missing: string[][];
  can_edit: boolean;
}

// ponytail: no i18n keys yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

const TYPES: { value: string; te: string; en: string; hintTe: string; hintEn: string }[] = [
  {
    value: 'citizen',
    te: 'పౌర విలేకరి',
    en: 'Citizen reporter',
    hintTe: 'మీ ప్రాంతంలో జరిగేది రాయడం',
    hintEn: 'Write what happens around you',
  },
  {
    value: 'freelance',
    te: 'ఫ్రీలాన్స్',
    en: 'Freelance',
    hintTe: 'ప్రెస్ కార్డు లేదా పోర్ట్‌ఫోలియో',
    hintEn: 'Press card or portfolio',
  },
  {
    value: 'student',
    te: 'విద్యార్థి',
    en: 'Student',
    hintTe: 'కళాశాల గుర్తింపు కార్డు',
    hintEn: 'College identity card',
  },
];

const DOC_LABELS: Record<string, { te: string; en: string }> = {
  pan: { te: 'పాన్ కార్డు', en: 'PAN card' },
  voter_id: { te: 'ఓటరు కార్డు', en: 'Voter ID' },
  driving_licence: { te: 'డ్రైవింగ్ లైసెన్స్', en: 'Driving licence' },
  passport: { te: 'పాస్‌పోర్ట్', en: 'Passport' },
  selfie: { te: 'మీ ఫోటో', en: 'Your photo' },
  press_accreditation: { te: 'ప్రెస్ అక్రిడిటేషన్', en: 'Press accreditation' },
  student_id: { te: 'కళాశాల ID', en: 'College ID' },
  college_bonafide: { te: 'బోనఫైడ్ సర్టిఫికెట్', en: 'Bonafide certificate' },
};

const STATUS_TEXT: Partial<Record<Status, { te: string; en: string }>> = {
  draft: {
    te: 'దరఖాస్తు ఇంకా పంపలేదు. పత్రాలు జోడించి పంపండి.',
    en: 'Not sent yet. Add your documents and submit.',
  },
  submitted: {
    te: 'మీ దరఖాస్తు అందింది. త్వరలో పరిశీలిస్తాం.',
    en: 'We have your application and will review it soon.',
  },
  in_review: { te: 'మీ దరఖాస్తు సమీక్షలో ఉంది.', en: 'Your application is in review.' },
  more_info: { te: 'మరికొంత సమాచారం కావాలి.', en: 'We need a little more information.' },
  approved: {
    te: 'మీరు ధృవీకరించబడ్డారు. ఇప్పుడు కథనాలు పంపవచ్చు.',
    en: 'You are verified. You can send stories now.',
  },
  rejected: { te: 'ఈసారి ఆమోదించలేకపోయాం.', en: 'We could not approve it this time.' },
  expired: {
    te: 'ధృవీకరణ గడువు ముగిసింది. మళ్లీ దరఖాస్తు చేయండి.',
    en: 'Your verification has expired. Please apply again.',
  },
};

const NAME_MIN = 2;

export default function ContributorScreen() {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { t, isTelugu } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuth((s) => s.me);

  const [typeEdit, setTypeEdit] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [organisation, setOrganisation] = useState('');
  const [touched, setTouched] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const application = useQuery({
    queryKey: ['contributor', 'me'],
    queryFn: async () => (await api.get<Application>('/users/me/contributor')).data,
    enabled: Boolean(me),
    retry: false,
  });

  const data = application.data;
  // Derived, not synced: the server value shows until the reader types over it.
  const type = typeEdit ?? data?.contributor_type ?? 'citizen';
  const name = nameEdit ?? data?.display_name_te ?? '';

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['contributor'] });

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/users/me/contributor', {
          contributor_type: type,
          display_name_te: name,
          organisation: organisation || null,
        })
      ).data,
    onSuccess: () => {
      toast.success(t('state.saved'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const upload = useMutation({
    mutationFn: async ({ kind, uri }: { kind: string; uri: string }) => {
      const form = new FormData();
      form.append('kind', kind);
      // React Native's FormData takes this shape for a file; the cast is the
      // standard workaround for its DOM-typed signature.
      form.append('file', { uri, name: `${kind}.jpg`, type: 'image/jpeg' } as unknown as Blob);
      return (await api.post('/users/me/contributor/documents', form)).data;
    },
    onSuccess: () => {
      toast.success(t('state.saved'));
      refresh();
    },
    onError: () =>
      toast.error(
        L(
          'అప్‌లోడ్ కాలేదు. ఫోటో స్పష్టంగా ఉందో చూసి మళ్లీ ప్రయత్నించండి.',
          'Upload failed. Check the photo is sharp and try again.',
          isTelugu,
        ),
      ),
  });

  const submit = useMutation({
    mutationFn: async () => (await api.post('/users/me/contributor/submit')).data,
    onSuccess: () => {
      setConfirmSubmit(false);
      toast.success(
        L('ధృవీకరణకు పంపాం.', 'Sent for verification.', isTelugu),
      );
      refresh();
    },
    onError: (error: unknown) => {
      setConfirmSubmit(false);
      const message = (error as { displayMessage?: string })?.displayMessage;
      toast.error(message ?? error);
    },
  });

  async function pick(kind: string) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    const result = permission.granted
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.uri) {
      setPreviews((current) => ({ ...current, [kind]: asset.uri }));
      upload.mutate({ kind, uri: asset.uri });
    }
  }

  const docLabel = (kind: string) => {
    const label = DOC_LABELS[kind];
    return label ? L(label.te, label.en, isTelugu) : kind;
  };

  if (!me) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: t('screen.contributor') }} />
        <EmptyState
          icon="logIn"
          title={t('ui.signInToContinue')}
          body={L(
            'దరఖాస్తు చేయడానికి సైన్ ఇన్ చేయండి.',
            'Sign in to apply as a contributor.',
            isTelugu,
          )}
        />
      </Screen>
    );
  }

  const canEdit = data?.can_edit ?? true;
  const nameError =
    touched && name.trim().length < NAME_MIN
      ? L('మీ పేరు రాయండి.', 'Enter the name to publish under.', isTelugu)
      : undefined;
  const status = data && data.status !== 'not_started' ? STATUS_TEXT[data.status] : undefined;

  return (
    <Screen edges={['bottom']} scroll keyboard contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: t('screen.contributor') }} />

      <T variant="bodySmall" color="inkSoft" scaled>
        {L(
          'పౌరులు, ఫ్రీలాన్స్, విద్యార్థి జర్నలిస్టులు తమ ప్రాంతం నుంచి కథనాలు పంపవచ్చు. ఒకసారి గుర్తింపు ధృవీకరించుకుంటే మీ పేరుపై అది కనిపిస్తుంది.',
          'Citizen, freelance and student journalists can send stories from their area. Once your identity is verified, your byline appears on them.',
          isTelugu,
        )}
      </T>

      {application.isLoading ? <LoadingState /> : null}
      {application.isError ? (
        <ErrorState
          error={application.error}
          fill={false}
          onRetry={() => void application.refetch()}
        />
      ) : null}

      {data && status ? (
        <Card style={styles.card}>
          <Badge
            tone={
              data.status === 'approved'
                ? 'success'
                : data.status === 'rejected' || data.status === 'expired'
                  ? 'breaking'
                  : 'partial'
            }
            size="xs"
            icon={data.status === 'approved' ? 'checkCircle2' : 'clock'}
            label={L(
              data.status === 'approved' ? 'ధృవీకరించబడింది' : 'పరిశీలనలో',
              data.status === 'approved' ? 'Verified' : 'In review',
              isTelugu,
            )}
          />
          <T variant="body" scaled>
            {L(status.te, status.en, isTelugu)}
          </T>
          {data.review_note ? (
            <T variant="bodySmall" color="inkSoft" lang="te" scaled>
              {data.review_note}
            </T>
          ) : null}
          {data.status === 'approved' ? (
            <Button
              variant="secondary"
              icon="send"
              iconRight="arrowRight"
              label={t('submit.title')}
              onPress={() => router.push('/submit')}
            />
          ) : null}
        </Card>
      ) : null}

      {canEdit ? (
        <Card style={styles.card}>
          <T variant="headlineSm" weight="bold" accessibilityRole="header">
            {L(
              'మీరు ఎవరిగా దరఖాస్తు చేస్తున్నారు',
              'What are you applying as?',
              isTelugu,
            )}
          </T>
          <View
            style={styles.types}
            accessibilityRole="radiogroup"
            accessibilityLabel={L('విలేకరి రకం', 'Contributor type', isTelugu)}
          >
            {TYPES.map((option) => (
              <View key={option.value} style={styles.type}>
                <Chip
                  role="radio"
                  label={L(option.te, option.en, isTelugu)}
                  selected={type === option.value}
                  onPress={() => setTypeEdit(option.value)}
                />
                <T variant="bodySmall" color="muted" scaled>
                  {L(option.hintTe, option.hintEn, isTelugu)}
                </T>
              </View>
            ))}
          </View>

          <Field
            label={L('మీ కథనాలపై కనిపించే పేరు', 'The name on your stories', isTelugu)}
            required
            error={nameError}
          >
            <Input
              value={name}
              onChangeText={setNameEdit}
              onBlur={() => setTouched(true)}
              lang="te"
              returnKeyType="done"
            />
          </Field>

          {type !== 'citizen' ? (
            <Field
              label={L(
                type === 'student' ? 'మీ కళాశాల' : 'మీరు రాసే సంస్థ',
                type === 'student' ? 'Your college' : 'The outlet you write for',
                isTelugu,
              )}
            >
              <Input
                value={organisation}
                onChangeText={setOrganisation}
                lang="te"
                returnKeyType="done"
              />
            </Field>
          ) : null}

          <Button
            label={save.isPending ? t('profile.saving') : t('ui.save')}
            icon="check"
            full
            pending={save.isPending}
            disabled={name.trim().length < NAME_MIN}
            onPress={() => save.mutate()}
          />
        </Card>
      ) : null}

      {data?.id ? (
        <Card style={styles.card}>
          <T variant="headlineSm" weight="bold" accessibilityRole="header">
            {L('మీ పత్రాలు', 'Your documents', isTelugu)}
          </T>

          <View style={styles.privacy}>
            <Icon name="shield" size={20} color={color.muted} />
            <T variant="bodySmall" color="inkSoft" scaled style={styles.privacyText}>
              {L(
                'మీ గుర్తింపు పత్రం ప్రైవేటుగా భద్రపరుస్తాం — బహిరంగ లింక్ ఉండదు. సీనియర్ ఎడిటర్లు మాత్రమే చూడగలరు, ప్రతిసారీ అది నమోదవుతుంది, గడువు ముగిశాక తొలగిస్తాం.',
                'Your ID is stored privately — there is no public link. Only senior editors can open it, every view is logged, and we delete it when it expires.',
                isTelugu,
              )}
            </T>
          </View>

          {data.documents.map((doc) => (
            <View key={doc.id} style={styles.doc}>
              {previews[doc.kind] ? (
                <Image
                  source={{ uri: previews[doc.kind] }}
                  style={styles.thumb}
                  contentFit="cover"
                  transition={m.imageTransition}
                  accessibilityLabel=""
                />
              ) : (
                <View style={styles.thumbFallback}>
                  <Icon name="fileText" size={20} color={color.muted} />
                </View>
              )}
              <View style={styles.docText}>
                <T variant="body" weight="semibold" scaled numberOfLines={2}>
                  {docLabel(doc.kind)}
                </T>
                {doc.number_masked ? (
                  <T variant="meta" color="muted" lang="en">
                    {doc.number_masked}
                  </T>
                ) : null}
              </View>
              <Icon name="checkCircle2" size={20} color={color.success} />
            </View>
          ))}

          {/* One button per group, labelled with the first accepted document —
              a joined list would be ellipsised away by the single-line label.
              The alternatives are spelt out underneath, where they wrap. */}
          {canEdit
            ? data.missing.map((group) => {
                const [first, ...rest] = group;
                if (!first) return null;
                return (
                  <View key={group.join('-')} style={styles.uploadGroup}>
                    <Button
                      variant="secondary"
                      icon="image"
                      full
                      label={docLabel(first)}
                      pending={upload.isPending && upload.variables?.kind === first}
                      disabled={upload.isPending}
                      onPress={() => void pick(first)}
                    />
                    {rest.length > 0 ? (
                      <T variant="bodySmall" color="muted" scaled>
                        {`${L('లేదా', 'or', isTelugu)} ${rest.map(docLabel).join(', ')}`}
                      </T>
                    ) : null}
                  </View>
                );
              })
            : null}

          {canEdit && data.missing.length === 0 ? (
            <Button
              label={submit.isPending ? t('submit.sending') : L('ధృవీకరణకు పంపండి', 'Send for verification', isTelugu)}
              icon="send"
              full
              pending={submit.isPending}
              onPress={() => setConfirmSubmit(true)}
              style={styles.upload}
            />
          ) : null}
        </Card>
      ) : null}

      <T variant="bodySmall" color="muted" scaled>
        {L(
          'ధృవీకరణ వల్ల మీరు ఎక్కువ కథనాలు పంపవచ్చు, ఫోటోలు జోడించవచ్చు. ప్రతి కథనాన్ని ఎడిటర్ చదివాకే ప్రచురిస్తాం — అది మారదు.',
          'Verification lets you send more stories and attach photographs. Every story is still read by an editor before it publishes — that does not change.',
          isTelugu,
        )}
      </T>

      <ConfirmSheet
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title={L('ధృవీకరణకు పంపాలా?', 'Send for verification?', isTelugu)}
        body={L(
          'పంపిన తర్వాత సమీక్ష పూర్తయ్యే వరకు వివరాలు మార్చలేరు.',
          'Once sent, you cannot edit the details until the review is done.',
          isTelugu,
        )}
        confirmLabel={L('పంపండి', 'Send', isTelugu)}
        pending={submit.isPending}
        onConfirm={() => submit.mutate()}
      />
    </Screen>
  );
}

const useStyles = makeStyles((color) => ({
  body: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  card: { gap: space.md },
  types: { gap: space.md },
  type: { gap: space.xs },
  privacy: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.paperSub,
  },
  privacyText: { flex: 1, minWidth: 0 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  docText: { flex: 1, minWidth: 0 },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: color.placeholder },
  thumbFallback: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: color.paperSub,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upload: { marginTop: space.xs },
  uploadGroup: { marginTop: space.xs, gap: space.xs },
}));
