import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import * as api from '@/api/epaper';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { ConfirmSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { Field, Input } from '@/ui/Input';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * My E-Paper — the reader builds a daily edition out of the sections, topics,
 * districts and mandals they care about, and the server generates it at the
 * chosen hour.
 *
 * The form is the house Field/Input/Chip set; renaming happens in place, and
 * deactivating an edition asks first (it stops tomorrow's paper arriving).
 */
type Preference = {
  preference_type: 'category' | 'district' | 'mandal' | 'tag';
  target_id: number;
  priority: number;
};

// ponytail: no i18n keys yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

const NAME_MIN = 2;

export default function MyEpaperScreen() {
  const styles = useStyles();
  const { t, pick, isTelugu } = useI18n();
  const toast = useToast();
  const me = useAuth((x) => x.me);
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Preference[]>([]);

  const toggle = (preference_type: Preference['preference_type'], target_id: number) =>
    setSelected((current) =>
      current.some((x) => x.preference_type === preference_type && x.target_id === target_id)
        ? current.filter(
            (x) => !(x.preference_type === preference_type && x.target_id === target_id),
          )
        : [...current, { preference_type, target_id, priority: current.length }],
    );
  const chosen = (type: Preference['preference_type'], id: number) =>
    selected.some((x) => x.preference_type === type && x.target_id === id);

  const opts = useQuery({
    queryKey: ['epaper-options'],
    queryFn: api.fetchOptions,
    enabled: Boolean(me),
  });
  const mine = useQuery({
    queryKey: ['my-epaper'],
    queryFn: api.fetchMine,
    enabled: Boolean(me),
  });

  const create = useMutation({
    mutationFn: () =>
      api.createMine({
        name,
        auto_generate: true,
        generation_time: '06:00:00',
        preferences: selected,
      }),
    onSuccess: () => {
      setName('');
      setTouched(false);
      setSelected([]);
      toast.success(t('state.saved'));
      void qc.invalidateQueries({ queryKey: ['my-epaper'] });
    },
    onError: (e) => toast.error(e),
  });

  const generate = useMutation({
    mutationFn: api.generateMine,
    onSuccess: (e) =>
      router.push({ pathname: '/my-epaper-edition/[id]', params: { id: String(e.id) } }),
    onError: (e) => toast.error(e),
  });

  const rename = useMutation({
    mutationFn: (row: api.UserEdition) =>
      api.updateMine(row.id, {
        name: editingName,
        auto_generate: row.auto_generate,
        generation_time: row.generation_time,
        preferences: row.preferences,
      }),
    onSuccess: () => {
      setEditingId(null);
      toast.success(t('state.saved'));
      void qc.invalidateQueries({ queryKey: ['my-epaper'] });
    },
    onError: (e) => toast.error(e),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteMine(id),
    onSuccess: () => {
      setConfirmId(null);
      toast.success(t('state.deleted'));
      void qc.invalidateQueries({ queryKey: ['my-epaper'] });
    },
    onError: (e) => {
      setConfirmId(null);
      toast.error(e);
    },
  });

  if (!me) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="logIn"
          title={t('ui.signInToContinue')}
          body={L(
            'మీ ఈ-పేపర్ కోసం ప్రొఫైల్‌లో లాగిన్ అవ్వండి.',
            'Sign in from the Profile tab to build your E-Paper.',
            isTelugu,
          )}
        />
      </Screen>
    );
  }

  const nameError =
    touched && name.trim().length < NAME_MIN
      ? L('కనీసం రెండు అక్షరాలు రాయండి.', 'Enter at least two characters.', isTelugu)
      : undefined;
  const canCreate = name.trim().length >= NAME_MIN && selected.length > 0 && !create.isPending;
  const editions = (mine.data?.items ?? []).filter((x) => x.is_active);

  const group = (
    title: string,
    rows: { id: number; name_te: string; name_en: string }[] | undefined,
    type: Preference['preference_type'],
  ) => (
    <View style={styles.group}>
      <T variant="headlineSm" weight="bold" accessibilityRole="header">
        {title}
      </T>
      <View style={styles.chips}>
        {(rows ?? []).map((x) => (
          <Chip
            key={x.id}
            label={pick(x.name_te, x.name_en)}
            selected={chosen(type, x.id)}
            onPress={() => toggle(type, x.id)}
          />
        ))}
      </View>
    </View>
  );

  return (
    <Screen edges={['bottom']} scroll keyboard contentContainerStyle={styles.body}>
      <T variant="headlineLg" weight="heavy" accessibilityRole="header">
        {L('నా ఈ-పేపర్ సృష్టించండి', 'Build my E-Paper', isTelugu)}
      </T>

      <Field
        label={L('ఎడిషన్ పేరు', 'Edition name', isTelugu)}
        required
        error={nameError}
        style={styles.field}
      >
        <Input
          value={name}
          onChangeText={setName}
          onBlur={() => setTouched(true)}
          placeholder={L('అజయ్ మార్నింగ్ ఎడిషన్', 'Ajay morning edition', isTelugu)}
          returnKeyType="done"
        />
      </Field>

      {opts.isLoading ? <LoadingState /> : null}
      {opts.isError ? (
        <ErrorState error={opts.error} fill={false} onRetry={() => void opts.refetch()} />
      ) : null}
      {opts.data ? (
        <>
          {group(L('విభాగాలు', 'Sections', isTelugu), opts.data.categories, 'category')}
          {group(L('అంశాలు', 'Topics', isTelugu), opts.data.tags, 'tag')}
          {group(L('జిల్లాలు', 'Districts', isTelugu), opts.data.districts, 'district')}
          {group(L('మండలాలు', 'Mandals', isTelugu), opts.data.mandals, 'mandal')}
        </>
      ) : null}

      <Button
        label={L('రోజువారీ ఎడిషన్ సేవ్ చేయండి', 'Save my daily edition', isTelugu)}
        icon="newspaper"
        full
        pending={create.isPending}
        disabled={!canCreate}
        onPress={() => create.mutate()}
        style={styles.save}
      />

      <T variant="headlineMd" weight="bold" style={styles.mineTitle} accessibilityRole="header">
        {L('నా ఎడిషన్లు', 'My editions', isTelugu)}
      </T>

      {mine.isLoading ? <LoadingState variant="list" rows={2} /> : null}
      {mine.isError ? (
        <ErrorState error={mine.error} fill={false} onRetry={() => void mine.refetch()} />
      ) : null}
      {mine.data && editions.length === 0 ? (
        <EmptyState
          icon="newspaper"
          body={L(
            'ఇంకా ఎడిషన్ లేదు. పైన ఒకటి సృష్టించండి.',
            'No editions yet — build one above.',
            isTelugu,
          )}
        />
      ) : null}

      {editions.map((x) => (
        <Card key={x.id} style={styles.card}>
          <T variant="headlineSm" weight="bold">
            {x.name}
          </T>
          <T variant="meta" color="muted">
            {`${x.preferences.length} ${L('అభిరుచులు', 'interests', isTelugu)} · ${x.generation_time.slice(0, 5)}`}
          </T>

          {editingId === x.id ? (
            <Field label={L('కొత్త పేరు', 'New name', isTelugu)} style={styles.field}>
              <Input
                value={editingName}
                onChangeText={setEditingName}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (editingName.trim().length >= NAME_MIN) rename.mutate(x);
                }}
              />
            </Field>
          ) : null}

          <View style={styles.row}>
            <Button
              label={L('ఈ రోజు చదవండి', 'Read today', isTelugu)}
              icon="bookOpen"
              pending={generate.isPending && generate.variables === x.id}
              onPress={() => generate.mutate(x.id)}
            />
            <Button
              label={editingId === x.id ? t('ui.save') : t('ui.edit')}
              variant="secondary"
              icon={editingId === x.id ? 'check' : 'pencil'}
              pending={rename.isPending && editingId === x.id}
              disabled={editingId === x.id && editingName.trim().length < NAME_MIN}
              onPress={() => {
                if (editingId === x.id) {
                  rename.mutate(x);
                } else {
                  setEditingId(x.id);
                  setEditingName(x.name);
                }
              }}
            />
            <Button
              label={L('నిలిపివేయండి', 'Deactivate', isTelugu)}
              variant="secondary"
              icon="trash2"
              onPress={() => setConfirmId(x.id)}
            />
          </View>
        </Card>
      ))}

      <ConfirmSheet
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title={L('ఈ ఎడిషన్ నిలిపివేయాలా?', 'Deactivate this edition?', isTelugu)}
        body={L(
          'రేపటి నుంచి ఇది రూపొందదు. మళ్లీ ఎప్పుడైనా కొత్తది సృష్టించవచ్చు.',
          'It will stop generating from tomorrow. You can always build a new one.',
          isTelugu,
        )}
        confirmLabel={t('ui.delete')}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => {
          if (confirmId !== null) remove.mutate(confirmId);
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  body: { padding: space.lg, paddingBottom: space.xxl },
  field: { marginTop: space.lg },
  group: { marginTop: space.lg, gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  save: { marginTop: space.xl },
  mineTitle: { marginTop: space.xxl },
  card: { marginTop: space.md, gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
}));
