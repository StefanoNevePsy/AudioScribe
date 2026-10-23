// =====================================================================
//  TEMA "CARTA E INCHIOSTRO"
//  Un taccuino editoriale: fondo carta calda, inchiostro quasi nero, un solo
//  accento vermiglio. Titoli in serif (Fraunces), testo in sans (Manrope).
// =====================================================================

export const getTheme = (dark: boolean) => (dark ? {
  bg: '#13110E',
  surface: '#1C1915',
  surfaceAlt: '#25211C',
  ink: '#F2EBDD',
  inkSoft: '#C9BFAE',
  muted: '#8F8676',
  line: '#2F2A23',
  accent: '#FF6B3D',
  accentInk: '#1A0D07',
  accentSoft: '#3A1F14',
  teal: '#86C7BA',
  danger: '#FF7A6B',
  statusBar: 'light-content' as const,
} : {
  bg: '#F3EEE4',
  surface: '#FBF8F2',
  surfaceAlt: '#EDE6D9',
  ink: '#1C1A16',
  inkSoft: '#3D3931',
  muted: '#7A7264',
  line: '#E1D8C8',
  accent: '#D9481C',
  accentInk: '#FFF7F2',
  accentSoft: '#F6DCCF',
  teal: '#1F5B55',
  danger: '#B8321B',
  statusBar: 'dark-content' as const,
});

export type Theme = ReturnType<typeof getTheme>;

// Su Android React Native seleziona il font dal nome del file in
// android/app/src/main/assets/fonts: un file per ogni peso.
export const font = {
  display: 'Fraunces-SemiBold',
  displayItalic: 'Fraunces-SemiBoldItalic',
  serif: 'Fraunces-Regular',
  serifItalic: 'Fraunces-Italic',
  body: 'Manrope-Regular',
  medium: 'Manrope-Medium',
  semibold: 'Manrope-SemiBold',
  bold: 'Manrope-Bold',
};

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Oggi", "Ieri", oppure "lunedì 20 ottobre". */
export const dayLabel = (ts: number) => {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(ts));
  if (day === today) return 'Oggi';
  if (day === today - 86_400_000) return 'Ieri';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
};

export const timeLabel = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Intestazione della home, es. "GIOVEDÌ 23 OTTOBRE". */
export const todayEyebrow = () => {
  const d = new Date();
  return `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`.toUpperCase();
};

export const formatBytes = (bytes: number) => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2).replace('.', ',')} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
};
