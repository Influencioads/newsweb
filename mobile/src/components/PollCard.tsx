import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import * as epaperApi from '@/api/epaper';
import type { Poll, PollOption as PollOptionData } from '@/api/epaper';
import { useI18n } from '@/lib/i18n';
import { DUR, useMotion } from '@/lib/motion';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { IconButton } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

// ponytail: no i18n keys yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

const useStyles = makeStyles((color) => ({
  card: { marginHorizontal: space.lg, marginTop: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center' },
  share: { marginLeft: 'auto' },
  options: { gap: space.sm },
  option: {
    minHeight: TAP,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.rule,
  },
  optionSelected: { borderColor: color.brand },
  // Rounded like the row so it never needs the row to clip it.
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.sm, backgroundColor: color.brandTint },
  label: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
}));

function PollOption({
  option,
  show,
  selected,
  disabled,
  onPress,
}: {
  option: PollOptionData;
  /** Results shown: the row is read-only text, not a control (so nothing dims). */
  show: boolean;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { pick } = useI18n();
  const percent = useSharedValue(0);
  const target = show ? option.percentage : 0;

  useEffect(() => {
    percent.value = m.timing(target, DUR.slow);
  }, [percent, m, target]);

  const bar = useAnimatedStyle(() => ({ width: `${percent.value}%` as const }));
  const label = pick(option.option_text_te, option.option_text_en);
  const body = (
    <>
      <Animated.View pointerEvents="none" style={[styles.fill, bar]} />
      {selected ? <Icon name="check" size={16} color={color.brand} strokeWidth={2.25} /> : null}
      <T variant="bodySmall" weight="semibold" style={styles.label}>
        {label}
      </T>
      {show ? (
        <T variant="meta" weight="bold" color="brand" lang="en">
          {option.percentage}%
        </T>
      ) : null}
    </>
  );

  if (show) {
    return (
      <View
        accessible
        accessibilityLabel={`${label}, ${option.percentage}%`}
        accessibilityState={{ selected }}
        style={[styles.option, selected && styles.optionSelected]}
      >
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="select"
      minHeight={TAP}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, selected }}
      style={[styles.option, selected && styles.optionSelected]}
    >
      {body}
    </PressableScale>
  );
}

export function PollCard({ poll }: { poll: Poll }) {
  const styles = useStyles();
  const m = useMotion();
  const { t, pick, isTelugu } = useI18n();
  const qc = useQueryClient();
  const [current, setCurrent] = useState(poll);
  const vote = useMutation({
    mutationFn: (id: number) => epaperApi.vote(current.id, id),
    onSuccess: (next) => {
      setCurrent(next);
      // Write through, so a remounted (virtualised) card shows the vote too.
      qc.setQueryData<Poll[]>(['big-question'], (old) => old?.map((p) => (p.id === next.id ? next : p)));
      m.haptic('success');
    },
  });
  const show = current.has_voted || current.status !== 'ACTIVE';

  return (
    <Card elevated style={styles.card}>
      <View style={styles.head}>
        <Badge
          tone="brand"
          icon="helpCircle"
          size="xs"
          label={current.is_big_question ? L('బిగ్ క్వశ్చన్', 'Big question', isTelugu) : t('screen.poll')}
        />
        <IconButton
          name="share2"
          label={t('ui.share')}
          style={styles.share}
          onPress={() =>
            Share.share({
              message: `${current.question_te}\nhttps://telugunews.influencioweb.com/polls/${current.id}`,
            })
          }
        />
      </View>

      <T variant="headlineMd" weight="heavy">
        {pick(current.question_te, current.question_en)}
      </T>

      <View
        style={styles.options}
        accessibilityRole={show ? undefined : 'radiogroup'}
        accessibilityLabel={show ? undefined : pick(current.question_te, current.question_en)}
      >
        {current.options.map((o) => (
          <PollOption
            key={o.id}
            option={o}
            show={show}
            selected={current.selected_option_id === o.id}
            disabled={vote.isPending}
            onPress={() => vote.mutate(o.id)}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <T variant="meta" color="muted">
          {current.total_votes} {L('ఓట్లు', 'votes', isTelugu)}
        </T>
      </View>

      {vote.isError ? (
        <T variant="bodySmall" color="breaking" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {L('మీ ఓటు నమోదు కాలేదు.', 'Your vote was not recorded.', isTelugu)}
        </T>
      ) : null}
    </Card>
  );
}
