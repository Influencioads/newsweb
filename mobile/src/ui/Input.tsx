import { createContext, forwardRef, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useI18n } from '@/lib/i18n';
import { MAX_FONT_MULTIPLIER, radius, space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon, type IconName } from '@/ui/Icon';
import { hasTelugu, T, textStyle, type TLang } from '@/ui/Text';

/**
 * Field + Input — the form primitives.
 *
 * `Field` stacks a label, the control, and one helper line (error wins over
 * hint) and hands both to the `Input` inside it through context, so the
 * text field is announced by its label and flagged invalid without the
 * caller repeating either. `Input` wraps RN `TextInput` in the house chrome:
 * field fill, a hairline that turns rule → brand on focus (breaking when
 * `invalid`), optional leading icon / trailing node, and a `n/max` counter.
 * Both faces come from the `body` step (17/29): Noto Sans Telugu when the
 * text, placeholder or app language is Telugu, Manrope otherwise — so the box
 * never jumps when the first Telugu character lands.
 */
export interface FieldProps {
  label?: string;
  hint?: string;
  /** Replaces the hint while set; announced to assistive tech. */
  error?: string;
  /** Appends a breaking (amber) asterisk to the label. */
  required?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const FieldCtx = createContext<{ label?: string; error?: string }>({});

export function Field({ label, hint, error, required, children, style }: FieldProps) {
  const styles = useStyles();
  const helper = error ?? hint;

  useEffect(() => {
    // accessibilityLiveRegion is Android-only; VoiceOver needs an explicit announcement.
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  return (
    <View style={[styles.field, style]}>
      {label ? (
        <T variant="ui" weight="semibold" style={styles.label}>
          {label}
          {required ? (
            <T variant="ui" weight="semibold" color="breaking" lang="en">
              {' *'}
            </T>
          ) : null}
        </T>
      ) : null}
      <FieldCtx.Provider value={{ label, error }}>{children}</FieldCtx.Provider>
      {helper ? (
        <T
          variant="meta"
          color={error ? 'breaking' : 'muted'}
          style={styles.helper}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
        >
          {helper}
        </T>
      ) : null}
    </View>
  );
}

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /**
   * Styles the WRAPPER, not the text. The field's own type styling is derived
   * from `lang` so that a Telugu input can never be given a line-height under
   * the §4.1 floor, which is why `style` is re-typed as a view style here.
   */
  style?: StyleProp<ViewStyle>;
  /** Validation failed: border and leading icon turn breaking. Implied by a `Field` error. */
  invalid?: boolean;
  leading?: IconName;
  /** Right-side node, e.g. a clear `IconButton`. */
  trailing?: ReactNode;
  /** Character cap; shows `n/counter` beneath and sets `maxLength` unless given. */
  counter?: number;
  /** Single-line height. Multiline fields grow from 120. */
  size?: 44 | 48;
  /** Script for the face. `auto` reads the text, then the placeholder, then the app language. */
  lang?: TLang;
}

/**
 * `style` lands on the outer container (margins, width); the text face is
 * chosen by `lang` and is not overridable — that keeps every Telugu input
 * on the safe line-height.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    invalid = false,
    leading,
    trailing,
    counter,
    size = TAP_LG,
    lang = 'auto',
    style,
    value,
    defaultValue,
    placeholder,
    multiline,
    editable = true,
    maxLength,
    onFocus,
    onBlur,
    onChangeText,
    accessibilityLabel,
    accessibilityHint,
    ...rest
  },
  ref,
) {
  const styles = useStyles();
  const color = useColors();
  const { isTelugu } = useI18n();
  const field = useContext(FieldCtx);
  const [focused, setFocused] = useState(false);
  // Uncontrolled inputs still need the live text for the face and the counter.
  const [text, setText] = useState(defaultValue ?? '');
  const current = value ?? text;

  const telugu =
    lang === 'te' || (lang === 'auto' && (hasTelugu(current) || hasTelugu(placeholder ?? '') || isTelugu));
  const bad = invalid || !!field.error;

  const borderColor = bad ? color.breaking : focused ? color.brand : color.rule;
  const accent = bad ? color.breaking : focused ? color.brand : color.muted;
  const len = current.length;

  return (
    <View style={style}>
      <View
        style={[
          styles.box,
          multiline ? styles.boxMultiline : { minHeight: size },
          !editable && styles.disabled,
          { borderColor },
        ]}
      >
        {leading ? <Icon name={leading} size={20} color={accent} style={styles.leading} /> : null}
        <TextInput
          ref={ref}
          {...rest}
          value={value}
          defaultValue={defaultValue}
          placeholder={placeholder}
          placeholderTextColor={color.muted}
          selectionColor={color.brand}
          cursorColor={color.brand}
          multiline={multiline}
          editable={editable}
          maxLength={maxLength ?? counter}
          textAlignVertical={multiline ? 'top' : 'center'}
          maxFontSizeMultiplier={MAX_FONT_MULTIPLIER}
          accessibilityLabel={accessibilityLabel ?? field.label}
          accessibilityHint={accessibilityHint ?? field.error}
          accessibilityState={{ disabled: !editable }}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          onChangeText={(next) => {
            setText(next);
            onChangeText?.(next);
          }}
          style={[styles.input, telugu ? styles.te : styles.en, multiline && styles.inputMultiline]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {counter !== undefined ? (
        <T variant="meta" color={len > counter ? 'breaking' : 'muted'} align="right" lang="en" style={styles.counter}>
          {`${len}/${counter}`}
        </T>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((color) => ({
  field: { gap: space.xs },
  label: { marginBottom: space.xs },
  helper: { marginTop: space.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.field,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  boxMultiline: { minHeight: 120, alignItems: 'flex-start', paddingVertical: space.sm },
  disabled: { opacity: 0.5 },
  input: { flex: 1, color: color.ink, paddingVertical: space.sm, paddingHorizontal: 0 },
  inputMultiline: { paddingVertical: space.xs },
  te: textStyle('body', 'regular', true),
  en: textStyle('body'),
  leading: { marginRight: space.sm },
  trailing: { marginLeft: space.xs, marginRight: -space.xs },
  counter: { marginTop: space.xs },
}));
