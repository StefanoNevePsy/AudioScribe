import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Animated, Easing,
  TextInputProps, ViewStyle, StyleProp,
} from 'react-native';
import { Theme, font } from './theme';

// ---------------------------------------------------------------------
//  Onda sonora: firma visiva dell'app. Altezze fisse (non casuali) cosi
//  il disegno e identico a ogni render.
// ---------------------------------------------------------------------
const WAVE = [0.35, 0.6, 0.9, 0.55, 1, 0.7, 0.4, 0.8, 0.5, 0.95, 0.6, 0.3, 0.7, 0.45];

export const Waveform = ({ color, height = 18, bars = 9, gap = 3, width = 3 }: {
  color: string; height?: number; bars?: number; gap?: number; width?: number;
}) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', height, gap }}>
    {WAVE.slice(0, bars).map((h, i) => (
      <View key={i} style={{ width, height: Math.max(3, h * height), borderRadius: width, backgroundColor: color }} />
    ))}
  </View>
);

export const AnimatedWaveform = ({ color, height = 56 }: { color: string; height?: number }) => {
  const values = useRef(WAVE.map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = values.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 70),
        Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [values]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height, gap: 6 }}>
      {values.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 5, height, borderRadius: 3, backgroundColor: color,
            transform: [{ scaleY: Animated.multiply(v, WAVE[i]) }],
          }}
        />
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------
//  Icone disegnate con View
// ---------------------------------------------------------------------
export const SlidersIcon = ({ color }: { color: string }) => (
  <View style={{ width: 18, gap: 4 }}>
    {[0.65, 0.25, 0.5].map((knob, i) => (
      <View key={i} style={{ height: 2, borderRadius: 1, backgroundColor: color, justifyContent: 'center' }}>
        <View style={{
          position: 'absolute', left: knob * 18 - 3, width: 6, height: 6, borderRadius: 3,
          backgroundColor: color,
        }} />
      </View>
    ))}
  </View>
);

export const CloseIcon = ({ color, size = 14 }: { color: string; size?: number }) => (
  <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', width: size * 1.2, height: 2, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
    <View style={{ position: 'absolute', width: size * 1.2, height: 2, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
  </View>
);

export const BackIcon = ({ color }: { color: string }) => (
  <View style={{ width: 14, height: 14, justifyContent: 'center' }}>
    <View style={{ position: 'absolute', left: 1, top: 3.5, width: 9, height: 2, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
    <View style={{ position: 'absolute', left: 1, top: 8.5, width: 9, height: 2, borderRadius: 1, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
  </View>
);

export const RoundButton = ({ theme, onPress, children, label }: {
  theme: Theme; onPress: () => void; children: React.ReactNode; label: string;
}) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    accessibilityLabel={label}
    style={[styles.round, { borderColor: theme.line, backgroundColor: theme.surface }]}
  >
    {children}
  </TouchableOpacity>
);

// ---------------------------------------------------------------------
//  Pulsanti
// ---------------------------------------------------------------------
type ButtonKind = 'ink' | 'accent' | 'outline' | 'ghost' | 'danger';

export const Button = ({ theme, kind = 'ink', label, onPress, style, left, disabled }: {
  theme: Theme; kind?: ButtonKind; label: string; onPress: () => void;
  style?: StyleProp<ViewStyle>; left?: React.ReactNode; disabled?: boolean;
}) => {
  const bg = { ink: theme.ink, accent: theme.accent, outline: 'transparent', ghost: 'transparent', danger: 'transparent' }[kind];
  const fg = { ink: theme.bg, accent: theme.accentInk, outline: theme.ink, ghost: theme.muted, danger: theme.danger }[kind];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : 1 },
        kind === 'outline' && { borderWidth: 1.5, borderColor: theme.ink },
        style,
      ]}
    >
      {left}
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
};

// ---------------------------------------------------------------------
//  Controllo segmentato
// ---------------------------------------------------------------------
export function Segmented<T extends string>({ theme, value, options, onChange }: {
  theme: Theme; value: T; onChange: (v: T) => void;
  options: { id: T; label: string; sub?: string }[];
}) {
  return (
    <View style={[styles.segment, { backgroundColor: theme.surfaceAlt }]}>
      {options.map(o => {
        const active = o.id === value;
        return (
          <TouchableOpacity
            key={o.id}
            onPress={() => onChange(o.id)}
            activeOpacity={0.8}
            style={[styles.segmentItem, active && { backgroundColor: theme.surface, borderColor: theme.line }]}
          >
            <Text style={{ fontFamily: active ? font.bold : font.semibold, fontSize: 14, color: active ? theme.ink : theme.muted }}>
              {o.label}
            </Text>
            {o.sub ? (
              <Text style={{ fontFamily: font.medium, fontSize: 10.5, marginTop: 2, color: active ? theme.accent : theme.muted }}>
                {o.sub}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------
//  Campi e sezioni del pannello impostazioni
// ---------------------------------------------------------------------
export const SectionTitle = ({ theme, number, title }: { theme: Theme; number: string; title: string }) => (
  <View style={styles.sectionTitle}>
    <Text style={{ fontFamily: font.serifItalic, fontSize: 15, color: theme.accent }}>{number}</Text>
    <Text style={{ fontFamily: font.display, fontSize: 22, color: theme.ink }}>{title}</Text>
  </View>
);

export const Field = ({ theme, label, hint, ...props }: TextInputProps & { theme: Theme; label: string; hint?: string }) => (
  <View style={{ marginTop: 16 }}>
    <Text style={[styles.fieldLabel, { color: theme.muted }]}>{label}</Text>
    <TextInput
      placeholderTextColor={theme.muted}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[
        styles.input,
        { color: theme.ink, backgroundColor: theme.surface, borderColor: theme.line },
        props.multiline && { minHeight: 84, textAlignVertical: 'top' },
      ]}
    />
    {hint ? <Text style={[styles.hint, { color: theme.muted }]}>{hint}</Text> : null}
  </View>
);

export const ProgressBar = ({ theme, value }: { theme: Theme; value: number }) => (
  <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
    <View style={[styles.fill, { backgroundColor: theme.accent, width: `${Math.max(2, Math.min(100, value * 100))}%` }]} />
  </View>
);

const styles = StyleSheet.create({
  round: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  button: {
    minHeight: 52, borderRadius: 26, paddingHorizontal: 22,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  buttonText: { fontFamily: font.bold, fontSize: 15, letterSpacing: 0.2 },
  segment: { flexDirection: 'row', borderRadius: 18, padding: 4, gap: 4 },
  segmentItem: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14,
    borderWidth: 1, borderColor: 'transparent',
  },
  sectionTitle: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 34, marginBottom: 4 },
  fieldLabel: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 },
  input: { fontFamily: font.medium, fontSize: 15, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  hint: { fontFamily: font.body, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
