import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, FlatList, Alert, useColorScheme,
  StatusBar, Animated, Easing,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import ShareMenu from 'react-native-share-menu';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Clipboard from '@react-native-clipboard/clipboard';
import { BlurView } from '@react-native-community/blur';

// --- CONFIGURAZIONE ---
const DEFAULT_WHISPER_MODEL = 'whisper-large-v3';
// llama-3.3-70b-versatile viene dismesso da Groq il 16/08/2026.
// Sostituito con il modello consigliato openai/gpt-oss-120b.
const DEFAULT_LLAMA_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_API_KEY = 'INSERISCI_QUI_LA_TUA_CHIAVE_GROQ';

// =====================================================================
//  PALETTE LIQUID GLASS
// =====================================================================
const getPalette = (isDark: boolean) => isDark ? {
  base: '#070711',
  blobs: ['#7C3AED', '#2563EB', '#DB2777', '#06B6D4'],
  glassTint: 'rgba(28, 28, 44, 0.55)',
  glassTintStrong: 'rgba(20, 20, 34, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',
  glassHighlight: 'rgba(255, 255, 255, 0.10)',
  blurType: 'dark' as const,
  fallback: '#15151F',
  text: '#F6F6FB',
  subText: 'rgba(246, 246, 251, 0.58)',
  inputBg: 'rgba(255, 255, 255, 0.06)',
  accent: '#A78BFA',
  accentSolid: '#7C3AED',
  success: '#34D399',
  danger: '#FB7185',
} : {
  base: '#EAEDFB',
  blobs: ['#A78BFA', '#60A5FA', '#F0ABFC', '#67E8F9'],
  glassTint: 'rgba(255, 255, 255, 0.45)',
  glassTintStrong: 'rgba(255, 255, 255, 0.62)',
  glassBorder: 'rgba(255, 255, 255, 0.70)',
  glassHighlight: 'rgba(255, 255, 255, 0.55)',
  blurType: 'light' as const,
  fallback: '#F2F4FE',
  text: '#181826',
  subText: 'rgba(24, 24, 38, 0.55)',
  inputBg: 'rgba(255, 255, 255, 0.55)',
  accent: '#7C3AED',
  accentSolid: '#7C3AED',
  success: '#16A34A',
  danger: '#E11D48',
};

type Palette = ReturnType<typeof getPalette>;

// =====================================================================
//  SFONDO "AURORA" ANIMATO (blobs morbidi che danno l'effetto liquido)
// =====================================================================
const AuroraBackground = ({ palette }: { palette: Palette }) => {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1, duration: 9000, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0, duration: 9000, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  const up = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -40] });
  const down = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 50] });
  const side = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 35] });

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.base }]} pointerEvents="none">
      <Animated.View style={[styles.blob, { backgroundColor: palette.blobs[0], top: -80, left: -60, transform: [{ translateY: up }, { translateX: side }] }]} />
      <Animated.View style={[styles.blob, { backgroundColor: palette.blobs[1], top: 120, right: -90, transform: [{ translateY: down }] }]} />
      <Animated.View style={[styles.blob, { backgroundColor: palette.blobs[2], bottom: 40, left: -70, transform: [{ translateY: up }] }]} />
      <Animated.View style={[styles.blobSmall, { backgroundColor: palette.blobs[3], bottom: 180, right: -30, transform: [{ translateX: side }] }]} />
    </View>
  );
};

// =====================================================================
//  SUPERFICIE IN VETRO (definita a livello di modulo -> niente remount,
//  i TextInput non perdono il focus)
// =====================================================================
type GlassProps = {
  palette: Palette;
  style?: any;
  radius?: number;
  strong?: boolean;
  children: React.ReactNode;
};

const GlassSurface = ({ palette, style, radius = 24, strong = false, children }: GlassProps) => (
  <View style={[{ borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: palette.glassBorder }, style]}>
    {/* Layer di blur reale: sfondo assoluto, NON avvolge il contenuto */}
    <BlurView
      style={StyleSheet.absoluteFill}
      blurType={palette.blurType}
      blurAmount={strong ? 28 : 18}
      reducedTransparencyFallbackColor={palette.fallback}
    />
    {/* Tinta semitrasparente: garantisce l'aspetto vetro anche se il blur non rende */}
    <View style={[StyleSheet.absoluteFill, { backgroundColor: strong ? palette.glassTintStrong : palette.glassTint }]} />
    {/* Riflesso superiore */}
    <View style={[styles.topHighlight, { backgroundColor: palette.glassHighlight }]} />
    {children}
  </View>
);

// =====================================================================
//  APP
// =====================================================================
const AppInner = () => {
  const systemScheme = useColorScheme();
  const isDarkMode = systemScheme === 'dark';
  const palette = getPalette(isDarkMode);
  const insets = useSafeAreaInsets();

  // --- STATI APP ---
  const [transcription, setTranscription] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'history' | 'reader' | 'overlay' | 'settings'>('history');

  // --- STATI IMPOSTAZIONI ---
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [whisperModel, setWhisperModel] = useState(DEFAULT_WHISPER_MODEL);
  const [llamaModel, setLlamaModel] = useState(DEFAULT_LLAMA_MODEL);

  // Evita di sovrascrivere lo storage prima del caricamento iniziale
  const historyLoaded = useRef(false);

  // --- CARICAMENTO INIZIALE + LISTENER CONDIVISIONE ---
  useEffect(() => {
    loadData();
    const handleShare = (item: any) => {
      if (item && item.data) {
        setViewMode('overlay');
        loadSettingsAndProcess(item.data);
      }
    };
    ShareMenu.getInitialShare(handleShare);
    const listener = ShareMenu.addNewShareListener(handleShare);
    return () => listener.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- PERSISTENZA CENTRALIZZATA DELLA CRONOLOGIA ---
  // Salva ogni volta che `history` cambia. Essendo un effetto, usa sempre
  // il valore aggiornato -> niente stale closure, niente cronologia persa.
  useEffect(() => {
    if (!historyLoaded.current) return;
    AsyncStorage.setItem('@history', JSON.stringify(history)).catch(() => {});
  }, [history]);

  const loadData = async () => {
    try {
      const jsonHistory = await AsyncStorage.getItem('@history');
      if (jsonHistory != null) setHistory(JSON.parse(jsonHistory));
      const savedKey = await AsyncStorage.getItem('@api_key');
      if (savedKey) setApiKey(savedKey);
      const savedWhisper = await AsyncStorage.getItem('@whisper_model');
      if (savedWhisper) setWhisperModel(savedWhisper);
      const savedLlama = await AsyncStorage.getItem('@llama_model');
      if (savedLlama) setLlamaModel(savedLlama);
    } catch (e) {
      // ignora
    } finally {
      historyLoaded.current = true;
    }
  };

  const loadSettingsAndProcess = async (uri: string) => {
    try {
      const savedKey = await AsyncStorage.getItem('@api_key');
      const savedWhisper = await AsyncStorage.getItem('@whisper_model');
      const savedLlama = await AsyncStorage.getItem('@llama_model');
      processAudio(uri, savedKey || apiKey, savedWhisper || whisperModel, savedLlama || llamaModel);
    } catch (e) {
      processAudio(uri, apiKey, whisperModel, llamaModel);
    }
  };

  const saveSettings = async () => {
    await AsyncStorage.setItem('@api_key', apiKey);
    await AsyncStorage.setItem('@whisper_model', whisperModel);
    await AsyncStorage.setItem('@llama_model', llamaModel);
    setViewMode('history');
    Alert.alert('Salvataggio', 'Impostazioni aggiornate.');
  };

  const resetSettings = () => {
    setWhisperModel(DEFAULT_WHISPER_MODEL);
    setLlamaModel(DEFAULT_LLAMA_MODEL);
    Alert.alert('Ripristinato', 'Modelli ripristinati.');
  };

  const processAudio = async (uri: string, keyToUse: string, whisperToUse: string, llamaToUse: string) => {
    setLoading(true);
    setTranscription('Trascrizione in corso...');
    try {
      let cleanUri = uri;
      if (!cleanUri.startsWith('file://') && !cleanUri.startsWith('content://')) {
        cleanUri = 'file://' + cleanUri;
      }
      const fileData: any = { uri: cleanUri, type: 'audio/ogg', name: 'audio.ogg' };

      const formData = new FormData();
      formData.append('file', fileData);
      formData.append('model', whisperToUse);
      formData.append('prompt', 'Testo in italiano.');

      const transRes = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
        headers: { Authorization: `Bearer ${keyToUse}`, 'Content-Type': 'multipart/form-data' },
      });

      const rawText = transRes.data.text;
      if (rawText.length < 10) { finishProcess(rawText); return; }

      setTranscription(`Formattazione con ${llamaToUse}...`);
      const chatRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: llamaToUse,
        messages: [
          { role: 'system', content: 'Formatta il seguente testo parlato: aggiungi punteggiatura, maiuscole e dividi in paragrafi. Non cambiare le parole.' },
          { role: 'user', content: rawText },
        ],
      }, {
        headers: { Authorization: `Bearer ${keyToUse}`, 'Content-Type': 'application/json' },
      });
      finishProcess(chatRes.data.choices[0].message.content);
    } catch (error: any) {
      let errorMsg = error.message;
      if (error.response && error.response.data && error.response.data.error) errorMsg = JSON.stringify(error.response.data.error);
      setTranscription('Errore: ' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Aggiunge in cronologia usando l'update funzionale: `prev` è sempre
  // l'ultimo valore, quindi le trascrizioni si accumulano correttamente
  // anche senza riavviare l'app.
  const finishProcess = (text: string) => {
    setTranscription(text);
    setViewMode('reader');
    const newItem = { id: Date.now().toString(), text, date: new Date().toLocaleString() };
    setHistory(prev => [newItem, ...prev]);
  };

  const copyText = (text: string) => {
    Clipboard.setString(text);
    Alert.alert('Copiato', 'Testo copiato negli appunti.');
  };

  const deleteItem = (id: string) => {
    Alert.alert('Elimina', 'Vuoi cancellare questa trascrizione?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: () => {
        setHistory(prev => prev.filter(item => item.id !== id));
        if (viewMode === 'reader') setViewMode('history');
      } },
    ]);
  };

  const clearAllHistory = () => {
    Alert.alert('Attenzione', 'Eliminare TUTTO?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'ELIMINA', style: 'destructive', onPress: () => setHistory([]) },
    ]);
  };

  const newTranscriptionHint = () => {
    Alert.alert(
      'Nuova trascrizione',
      'Condividi un messaggio vocale verso AudioScribe dal menu di condivisione di WhatsApp. Puoi farne quante vuoi di seguito: si aggiungeranno qui sotto.',
    );
  };

  // ===================================================================
  //  RENDER: IMPOSTAZIONI  (reso inline -> i TextInput tengono il focus)
  // ===================================================================
  const renderSettings = () => (
    <View style={styles.fill}>
      <AuroraBackground palette={palette} />
      <View style={[styles.centeredOverlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <GlassSurface palette={palette} strong style={styles.settingsCard}>
          <View style={styles.settingsInner}>
            <Text style={[styles.title, { color: palette.text, marginBottom: 20 }]}>Impostazioni</Text>

            <Text style={[styles.label, { color: palette.subText }]}>API Key Groq</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.inputBg, color: palette.text, borderColor: palette.glassBorder }]}
              value={apiKey} onChangeText={setApiKey} placeholder="gsk_..."
              placeholderTextColor={palette.subText} secureTextEntry
            />

            <Text style={[styles.label, { color: palette.subText }]}>Modello Audio</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.inputBg, color: palette.text, borderColor: palette.glassBorder }]}
              value={whisperModel} onChangeText={setWhisperModel}
              placeholderTextColor={palette.subText} autoCapitalize="none"
            />

            <Text style={[styles.label, { color: palette.subText }]}>Modello Testo</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.inputBg, color: palette.text, borderColor: palette.glassBorder }]}
              value={llamaModel} onChangeText={setLlamaModel}
              placeholderTextColor={palette.subText} autoCapitalize="none"
            />

            <TouchableOpacity onPress={resetSettings} style={{ marginTop: 6, marginBottom: 22 }}>
              <Text style={{ color: palette.accent, textAlign: 'right', fontWeight: '600' }}>Ripristina Default</Text>
            </TouchableOpacity>

            <View style={styles.rowBetween}>
              <TouchableOpacity onPress={() => setViewMode('history')} style={styles.ghostButton}>
                <Text style={{ color: palette.subText, fontWeight: '600' }}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveSettings} style={[styles.primaryButton, { backgroundColor: palette.accentSolid }]}>
                <Text style={styles.primaryButtonText}>Salva</Text>
              </TouchableOpacity>
            </View>
          </View>
        </GlassSurface>
      </View>
    </View>
  );

  // ===================================================================
  //  RENDER: LETTORE (bottom sheet in vetro)
  // ===================================================================
  const renderReader = () => (
    <View style={styles.fill}>
      <AuroraBackground palette={palette} />
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      <View style={styles.bottomSheetWrap}>
        <TouchableOpacity activeOpacity={1} style={styles.flexTap} onPress={() => setViewMode('history')} />

        <GlassSurface palette={palette} strong radius={32} style={[styles.sheetCard, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.sheetInner}>
            <View style={[styles.grabber, { backgroundColor: palette.glassBorder }]} />

            <View style={styles.sheetHeader}>
              <Text style={[styles.title, { color: palette.text }]}>Trascrizione</Text>
              <View style={styles.headerActions}>
                {!loading && (
                  <TouchableOpacity onPress={() => copyText(transcription)} style={[styles.pill, { borderColor: palette.glassBorder }]}>
                    <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 12 }}>COPIA</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setViewMode('history')} style={[styles.iconPill, { borderColor: palette.glassBorder }]}>
                  <Text style={{ color: palette.text, fontSize: 15, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            {loading ? (
              <View style={styles.centerContent}>
                <ActivityIndicator size="large" color={palette.accent} />
                <Text style={{ marginTop: 16, color: palette.subText, textAlign: 'center' }}>{transcription}</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
                <Text style={[styles.resultText, { color: palette.text }]} selectable>{transcription}</Text>
              </ScrollView>
            )}
          </View>
        </GlassSurface>
      </View>
    </View>
  );

  // ===================================================================
  //  RENDER: CRONOLOGIA (schermata principale)
  // ===================================================================
  const renderHistory = () => (
    <View style={styles.fill}>
      <AuroraBackground palette={palette} />
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <View style={[styles.historyContainer, { paddingTop: insets.top + 16 }]}>
        <View style={styles.mainHeaderRow}>
          <View>
            <Text style={[styles.brand, { color: palette.text }]}>AudioScribe</Text>
            <Text style={[styles.brandSub, { color: palette.subText }]}>
              {history.length > 0 ? `${history.length} trascrizion${history.length === 1 ? 'e' : 'i'}` : 'Pronto a trascrivere'}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {history.length > 0 && (
              <TouchableOpacity onPress={clearAllHistory} style={[styles.iconPill, { borderColor: palette.glassBorder }]}>
                <Text style={{ fontSize: 17 }}>🗑️</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setViewMode('settings')} style={[styles.iconPill, { borderColor: palette.glassBorder }]}>
              <Text style={{ fontSize: 18 }}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        <FlatList
          data={history}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <GlassSurface palette={palette} style={styles.emptyCard}>
              <View style={styles.emptyInner}>
                <Text style={styles.emptyEmoji}>🎙️</Text>
                <Text style={[styles.emptyTitle, { color: palette.text }]}>Nessuna trascrizione</Text>
                <Text style={[styles.emptyText, { color: palette.subText }]}>
                  Condividi un messaggio vocale da WhatsApp verso AudioScribe per iniziare.
                </Text>
              </View>
            </GlassSurface>
          }
          renderItem={({ item }) => (
            <GlassSurface palette={palette} style={styles.historyItem}>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.historyItemInner}
                onPress={() => { setTranscription(item.text); setViewMode('reader'); }}
              >
                <View style={styles.rowBetween}>
                  <Text style={[styles.historyDate, { color: palette.subText }]}>{item.date}</Text>
                  <View style={styles.headerActions}>
                    <TouchableOpacity onPress={() => copyText(item.text)}>
                      <Text style={{ color: palette.accent, fontSize: 12, fontWeight: '700' }}>COPIA</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteItem(item.id)}>
                      <Text style={{ color: palette.danger, fontSize: 12, fontWeight: '700' }}>ELIMINA</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={[styles.historyText, { color: palette.text }]} numberOfLines={3}>{item.text}</Text>
              </TouchableOpacity>
            </GlassSurface>
          )}
        />
      </View>

      {/* FAB informativo per la prossima trascrizione */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={newTranscriptionHint}
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
      >
        <GlassSurface palette={palette} strong radius={30} style={styles.fabGlass}>
          <View style={styles.fabInner}>
            <Text style={[styles.fabText, { color: palette.text }]}>＋  Nuova</Text>
          </View>
        </GlassSurface>
      </TouchableOpacity>
    </View>
  );

  // --- MAIN RENDER ---
  if (viewMode === 'settings') return renderSettings();
  if (viewMode === 'overlay' || viewMode === 'reader') return renderReader();
  return renderHistory();
};

const App = () => (
  <SafeAreaProvider>
    <AppInner />
  </SafeAreaProvider>
);

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flexTap: { flex: 1 },

  // Aurora
  blob: { position: 'absolute', width: 320, height: 320, borderRadius: 160, opacity: 0.55 },
  blobSmall: { position: 'absolute', width: 220, height: 220, borderRadius: 110, opacity: 0.45 },

  // Glass
  topHighlight: { position: 'absolute', top: 0, left: 0, right: 0, height: 1.5 },

  // Header
  historyContainer: { flex: 1, paddingHorizontal: 18 },
  mainHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  brand: { fontSize: 30, fontWeight: '800', letterSpacing: 0.3 },
  brandSub: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  headerActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },

  // Pills / buttons
  iconPill: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { paddingVertical: 12, paddingHorizontal: 26, borderRadius: 14 },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  ghostButton: { paddingVertical: 12, paddingHorizontal: 22, borderRadius: 14 },

  // History items
  historyItem: { marginBottom: 14 },
  historyItemInner: { padding: 16 },
  historyDate: { fontSize: 12, fontWeight: '600' },
  historyText: { fontSize: 14, lineHeight: 21, marginTop: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  // Empty
  emptyCard: { marginTop: 40 },
  emptyInner: { padding: 30, alignItems: 'center' },
  emptyEmoji: { fontSize: 40, marginBottom: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },

  // Reader bottom sheet
  bottomSheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheetCard: { height: '78%', width: '100%', borderBottomWidth: 0 },
  sheetInner: { flex: 1, paddingHorizontal: 22, paddingTop: 12 },
  grabber: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  title: { fontSize: 20, fontWeight: '800' },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 60 },
  resultText: { fontSize: 16, lineHeight: 25 },

  // Settings
  centeredOverlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  settingsCard: { width: '100%' },
  settingsInner: { padding: 24 },
  label: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { padding: 13, borderRadius: 12, fontSize: 16, borderWidth: 1 },

  // FAB
  fab: { position: 'absolute', right: 18 },
  fabGlass: {},
  fabInner: { paddingVertical: 14, paddingHorizontal: 22 },
  fabText: { fontSize: 15, fontWeight: '700' },
});

export default App;
