import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, SectionList, Alert,
  useColorScheme, StatusBar, AppState, Switch, Share,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import ShareMenu from 'react-native-share-menu';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';

import { getTheme, font, dayLabel, timeLabel, todayEyebrow, formatBytes } from './src/theme';
import {
  Engine, ENGINE_LABELS, DEFAULTS, Native, LocalAsr, localAsrEvents, errorMessage,
  transcribeWithGroq, transcribeWithGemini, transcribeLocally,
} from './src/engines';
import {
  Waveform, AnimatedWaveform, SlidersIcon, BackIcon, RoundButton, Button,
  Segmented, SectionTitle, Field, ProgressBar,
} from './src/ui';

const ACTION_TRANSCRIBE_LATEST = 'com.audioscribe.glass.TRANSCRIBE_LATEST';

type Item = { id: string; text: string; ts: number; engine?: Engine; date?: string };
type View_ = 'history' | 'reader' | 'settings';
type LocalStatus = { installed: boolean; downloadedBytes: number; totalBytes: number };

// Le voci salvate dalle versioni precedenti non hanno `ts`: l'id e un Date.now().
const itemTs = (item: Item) => item.ts || Number(item.id) || 0;

const AppInner = () => {
  const dark = useColorScheme() === 'dark';
  const theme = useMemo(() => getTheme(dark), [dark]);
  const insets = useSafeAreaInsets();

  // --- STATI APP ---
  const [history, setHistory] = useState<Item[]>([]);
  const [viewMode, setViewMode] = useState<View_>('history');
  const [current, setCurrent] = useState<Item | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  // --- STATI IMPOSTAZIONI ---
  const [provider, setProvider] = useState<Engine>('groq');
  const [apiKey, setApiKey] = useState(DEFAULTS.apiKey);
  const [whisperModel, setWhisperModel] = useState(DEFAULTS.whisperModel);
  const [llamaModel, setLlamaModel] = useState(DEFAULTS.llamaModel);
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState(DEFAULTS.geminiModel);
  const [geminiSmart, setGeminiSmart] = useState(true);
  const [geminiLang, setGeminiLang] = useState('auto'); // 'auto' | codice BCP-47
  const [geminiVocab, setGeminiVocab] = useState('');

  // --- MODELLO LOCALE ---
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [download, setDownload] = useState({ received: 0, total: 1, label: '' });

  // Evita di sovrascrivere lo storage prima del caricamento iniziale
  const historyLoaded = useRef(false);

  // --- CARICAMENTO INIZIALE + LISTENER CONDIVISIONE ---
  useEffect(() => {
    loadData();
    refreshLocalStatus();
    const handleShare = (item: any) => {
      if (item && item.data) runTranscription(item.data, item.mimeType);
    };
    ShareMenu.getInitialShare(handleShare);
    const listener = ShareMenu.addNewShareListener(handleShare);
    const dl = localAsrEvents?.addListener('LocalAsrDownload', e => setDownload(e));
    return () => { listener.remove(); dl?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- PERSISTENZA CENTRALIZZATA DELLA CRONOLOGIA ---
  // Salva ogni volta che `history` cambia. Essendo un effetto, usa sempre
  // il valore aggiornato -> niente stale closure, niente cronologia persa.
  useEffect(() => {
    if (!historyLoaded.current) return;
    AsyncStorage.setItem('@history', JSON.stringify(history)).catch(() => {});
  }, [history]);

  // --- SCORCIATOIA "TRASCRIVI ULTIMO VOCALE" ---
  // L'app puo essere aperta dalla scorciatoia sulla home: in quel caso parte
  // subito la trascrizione. Controlliamo anche al ritorno in primo piano,
  // perche con launchMode=singleTask l'app potrebbe essere gia aperta.
  useEffect(() => {
    if (!Native) return;
    const checkLaunchAction = async () => {
      try {
        const action = await Native.consumeLaunchAction();
        if (action === ACTION_TRANSCRIBE_LATEST) transcribeLatest();
      } catch (e) {
        // nessuna azione da gestire
      }
    };
    checkLaunchAction();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') checkLaunchAction();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    try {
      const get = (k: string) => AsyncStorage.getItem(k);
      const jsonHistory = await get('@history');
      if (jsonHistory != null) setHistory(JSON.parse(jsonHistory));
      const savedProvider = await get('@provider');
      if (savedProvider === 'gemini' || savedProvider === 'groq' || savedProvider === 'local') setProvider(savedProvider);
      setApiKey((await get('@api_key')) || DEFAULTS.apiKey);
      setWhisperModel((await get('@whisper_model')) || DEFAULTS.whisperModel);
      setLlamaModel((await get('@llama_model')) || DEFAULTS.llamaModel);
      setGeminiKey((await get('@gemini_key')) || '');
      setGeminiModel((await get('@gemini_model')) || DEFAULTS.geminiModel);
      const savedSmart = await get('@gemini_smart');
      if (savedSmart != null) setGeminiSmart(savedSmart === '1');
      setGeminiLang((await get('@gemini_lang')) || 'auto');
      setGeminiVocab((await get('@gemini_vocab')) || '');
    } catch (e) {
      // ignora
    } finally {
      historyLoaded.current = true;
    }
  };

  const refreshLocalStatus = async () => {
    if (!LocalAsr) return;
    try { setLocalStatus(await LocalAsr.getModelStatus()); } catch (e) { /* ignora */ }
  };

  // Legge le impostazioni salvate (non lo stato, che potrebbe non essere
  // ancora popolato quando l'app viene aperta dalla condivisione) e instrada
  // verso il motore scelto.
  const runTranscription = async (uri: string, sharedMime?: string) => {
    setCurrent(null);
    setError('');
    setStatus('Preparazione…');
    setLoading(true);
    setViewMode('reader');

    const get = (k: string) => AsyncStorage.getItem(k);
    let engine: Engine = 'groq';
    try {
      engine = ((await get('@provider')) as Engine) || provider;
      let text: string;
      if (engine === 'local') {
        text = await transcribeLocally(uri, setStatus);
      } else if (engine === 'gemini') {
        const savedSmart = await get('@gemini_smart');
        text = await transcribeWithGemini(uri, sharedMime, {
          key: (await get('@gemini_key')) || geminiKey,
          model: (await get('@gemini_model')) || geminiModel,
          smart: savedSmart != null ? savedSmart === '1' : geminiSmart,
          lang: (await get('@gemini_lang')) || geminiLang,
          vocab: (await get('@gemini_vocab')) ?? geminiVocab,
        }, setStatus);
      } else {
        text = await transcribeWithGroq(uri, {
          key: (await get('@api_key')) || apiKey,
          whisperModel: (await get('@whisper_model')) || whisperModel,
          llamaModel: (await get('@llama_model')) || llamaModel,
        }, setStatus);
      }
      finishProcess(text, engine);
    } catch (e: any) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // Aggiunge in cronologia usando l'update funzionale: `prev` è sempre
  // l'ultimo valore, quindi le trascrizioni si accumulano correttamente
  // anche senza riavviare l'app.
  const finishProcess = (text: string, engine: Engine) => {
    const ts = Date.now();
    const item: Item = { id: String(ts), text: text.trim(), ts, engine };
    setCurrent(item);
    setHistory(prev => [item, ...prev]);
  };

  const saveSettings = async () => {
    await AsyncStorage.multiSet([
      ['@provider', provider],
      ['@api_key', apiKey],
      ['@whisper_model', whisperModel],
      ['@llama_model', llamaModel],
      ['@gemini_key', geminiKey],
      ['@gemini_model', geminiModel],
      ['@gemini_smart', geminiSmart ? '1' : '0'],
      ['@gemini_lang', geminiLang],
      ['@gemini_vocab', geminiVocab],
    ]);
    setViewMode('history');
    if (provider === 'local' && !localStatus?.installed) {
      Alert.alert('Modello non ancora scaricato', 'Hai scelto la trascrizione locale: scarica il modello dalle Impostazioni prima di trascrivere.');
    }
  };

  const resetSettings = () => {
    setWhisperModel(DEFAULTS.whisperModel);
    setLlamaModel(DEFAULTS.llamaModel);
    setGeminiModel(DEFAULTS.geminiModel);
  };

  const copyText = (text: string) => {
    Clipboard.setString(text);
    Alert.alert('Copiato', 'Testo copiato negli appunti.');
  };

  const shareText = (text: string) => { Share.share({ message: text }).catch(() => {}); };

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
    Alert.alert('Svuotare la cronologia?', 'Tutte le trascrizioni verranno eliminate.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina tutto', style: 'destructive', onPress: () => setHistory([]) },
    ]);
  };

  // --- ULTIMO VOCALE: trascrive senza passare dalla condivisione ---
  const transcribeLatest = async () => {
    if (!Native) return;
    try {
      const allowed = await Native.hasAllFilesAccess();
      if (!allowed) {
        Alert.alert(
          'Permesso necessario',
          'Per trovare da solo l\'ultimo vocale serve l\'accesso ai file: la cartella di WhatsApp non e visibile alle app senza di esso.\n\n' +
          'Nella schermata che si apre attiva "Consenti accesso per gestire tutti i file", poi torna qui.',
          [
            { text: 'Annulla', style: 'cancel' },
            { text: 'Apri impostazioni', onPress: () => { Native.requestAllFilesAccess().catch(() => {}); } },
          ],
        );
        return;
      }
      const latest = await Native.findLatestVoiceNote();
      if (!latest || !latest.uri) {
        Alert.alert('Nessun vocale trovato', 'Non ho trovato vocali WhatsApp sul dispositivo. Puoi sempre usare Condividi da WhatsApp.');
        return;
      }
      runTranscription(latest.uri, latest.mimeType);
    } catch (e: any) {
      Alert.alert('Errore', e?.message || 'Impossibile cercare l\'ultimo vocale.');
    }
  };

  // --- GESTIONE MODELLO LOCALE ---
  const startDownload = () => {
    const doIt = async () => {
      setDownloading(true);
      try {
        await LocalAsr.downloadModel();
      } catch (e: any) {
        if (e?.code !== 'E_CANCELLED') Alert.alert('Download non riuscito', errorMessage(e));
      } finally {
        setDownloading(false);
        refreshLocalStatus();
      }
    };
    const size = formatBytes(localStatus?.totalBytes || 0);
    Alert.alert(
      'Scaricare Parakeet Ultra?',
      `Sono circa ${size}: meglio con il Wi-Fi. Se il download si interrompe, riprendera da dove si era fermato.`,
      [{ text: 'Annulla', style: 'cancel' }, { text: 'Scarica', onPress: doIt }],
    );
  };

  const deleteLocalModel = () => {
    Alert.alert('Eliminare il modello?', 'Libererai lo spazio sul telefono. Potrai riscaricarlo quando vuoi.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: async () => {
        await LocalAsr.deleteModel();
        refreshLocalStatus();
      } },
    ]);
  };

  // ===================================================================
  //  DATI DERIVATI
  // ===================================================================
  const sections = useMemo(() => {
    const groups: { title: string; data: Item[] }[] = [];
    for (const item of history) {
      const title = dayLabel(itemTs(item));
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.data.push(item);
      else groups.push({ title, data: [item] });
    }
    return groups;
  }, [history]);

  const engineMeta = (e?: Engine) => (e ? ENGINE_LABELS[e].name : '');

  // ===================================================================
  //  SCHERMATA: CRONOLOGIA
  // ===================================================================
  const renderHistory = () => (
    <View style={[styles.fill, { backgroundColor: theme.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: 20, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            <View style={styles.rowBetween}>
              <Text style={[styles.eyebrow, { color: theme.muted }]}>{todayEyebrow()}</Text>
              <RoundButton theme={theme} label="Impostazioni" onPress={() => setViewMode('settings')}>
                <SlidersIcon color={theme.ink} />
              </RoundButton>
            </View>
            <Text style={[styles.wordmark, { color: theme.ink }]}>
              Audio<Text style={{ fontFamily: font.displayItalic, color: theme.accent }}>Scribe</Text>
            </Text>
            <View style={[styles.rowStart, { marginTop: 10 }]}>
              <Waveform color={theme.accent} height={14} bars={7} width={2.5} gap={2.5} />
              <Text style={[styles.subline, { color: theme.inkSoft }]}>
                {history.length === 0
                  ? 'Nessuna trascrizione'
                  : `${history.length} trascrizion${history.length === 1 ? 'e' : 'i'}`}
                <Text style={{ color: theme.muted }}>{'  ·  '}{ENGINE_LABELS[provider].name}</Text>
              </Text>
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHeader}>
            <Text style={[styles.dayTitle, { color: theme.ink }]}>{section.title}</Text>
            <View style={[styles.hairline, { backgroundColor: theme.line }]} />
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => { setCurrent(item); setError(''); setLoading(false); setViewMode('reader'); }}
            style={[styles.note, { backgroundColor: theme.surface, borderColor: theme.line }]}
          >
            <View style={styles.rowBetween}>
              <Text style={[styles.noteTime, { color: theme.ink }]}>{timeLabel(itemTs(item))}</Text>
              {item.engine ? (
                <Text style={[styles.tag, { color: theme.muted, borderColor: theme.line }]}>
                  {engineMeta(item.engine)}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.noteText, { color: theme.inkSoft }]} numberOfLines={4}>{item.text}</Text>
            <View style={[styles.noteActions, { borderTopColor: theme.line }]}>
              <TouchableOpacity onPress={() => copyText(item.text)} hitSlop={8}>
                <Text style={[styles.action, { color: theme.accent }]}>Copia</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => shareText(item.text)} hitSlop={8}>
                <Text style={[styles.action, { color: theme.ink }]}>Condividi</Text>
              </TouchableOpacity>
              <View style={styles.fill} />
              <TouchableOpacity onPress={() => deleteItem(item.id)} hitSlop={8}>
                <Text style={[styles.action, { color: theme.muted }]}>Elimina</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={{ marginTop: 40 }}>
            <Text style={[styles.emptyQuote, { color: theme.ink }]}>
              Ogni vocale,{'\n'}<Text style={{ color: theme.accent }}>nero su bianco.</Text>
            </Text>
            {[
              ['Condividi', 'un vocale da WhatsApp verso AudioScribe.'],
              ['Oppure tocca', '"Ultimo vocale" qui sotto: lo trova da solo.'],
              ['Rileggi', 'tutto qui, raccolto giorno per giorno.'],
            ].map(([strong, rest], i) => (
              <View key={i} style={styles.step}>
                <Text style={[styles.stepNum, { color: theme.accent }]}>{`0${i + 1}`}</Text>
                <Text style={[styles.stepText, { color: theme.inkSoft }]}>
                  <Text style={{ fontFamily: font.bold, color: theme.ink }}>{strong} </Text>{rest}
                </Text>
              </View>
            ))}
          </View>
        }
      />

      <View style={[styles.dock, { paddingBottom: insets.bottom + 16, backgroundColor: theme.bg, borderTopColor: theme.line }]}>
        <Button
          theme={theme}
          kind="ink"
          label="Trascrivi ultimo vocale"
          onPress={transcribeLatest}
          left={<Waveform color={theme.accent} height={16} bars={5} width={3} gap={2.5} />}
        />
      </View>
    </View>
  );

  // ===================================================================
  //  SCHERMATA: LETTORE (anche durante la trascrizione)
  // ===================================================================
  const renderReader = () => {
    const inHistory = current && history.some(h => h.id === current.id);
    return (
      <View style={[styles.fill, { backgroundColor: theme.surface }]}>
        <View style={[styles.readerTop, { paddingTop: insets.top + 12, borderBottomColor: theme.line }]}>
          <RoundButton theme={theme} label="Indietro" onPress={() => setViewMode('history')}>
            <BackIcon color={theme.ink} />
          </RoundButton>
          <Text style={[styles.eyebrow, { color: theme.muted }]}>
            {loading ? 'IN CORSO' : error ? 'ERRORE' : 'TRASCRIZIONE'}
          </Text>
          <View style={{ width: 44 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <AnimatedWaveform color={theme.accent} />
            <Text style={[styles.statusText, { color: theme.ink }]}>{status}</Text>
            <Text style={[styles.statusSub, { color: theme.muted }]}>
              {provider === 'local' ? 'Sul dispositivo, senza connessione' : 'Può volerci qualche secondo'}
            </Text>
          </View>
        ) : error ? (
          <View style={[styles.center, { paddingHorizontal: 32 }]}>
            <Text style={[styles.errorTitle, { color: theme.ink }]}>Qualcosa è andato storto</Text>
            <Text style={[styles.errorText, { color: theme.inkSoft }]} selectable>{error}</Text>
            <Button theme={theme} kind="outline" label="Torna alle trascrizioni" onPress={() => setViewMode('history')} style={{ marginTop: 24 }} />
          </View>
        ) : current ? (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 26, paddingTop: 26, paddingBottom: 40 }}>
              <Text style={[styles.readerMeta, { color: theme.muted }]}>
                {dayLabel(itemTs(current))}{'  ·  '}{timeLabel(itemTs(current))}
                {current.engine ? `  ·  ${ENGINE_LABELS[current.engine].name} — ${ENGINE_LABELS[current.engine].tag}` : ''}
              </Text>
              <View style={[styles.accentRule, { backgroundColor: theme.accent }]} />
              <Text style={[styles.readerText, { color: theme.ink }]} selectable>{current.text}</Text>
            </ScrollView>
            <View style={[styles.readerBar, { paddingBottom: insets.bottom + 14, borderTopColor: theme.line, backgroundColor: theme.surface }]}>
              <Button theme={theme} kind="ink" label="Copia" onPress={() => copyText(current.text)} style={styles.fill} />
              <Button theme={theme} kind="outline" label="Condividi" onPress={() => shareText(current.text)} style={styles.fill} />
              {inHistory ? (
                <Button theme={theme} kind="danger" label="Elimina" onPress={() => deleteItem(current.id)} style={{ paddingHorizontal: 12 }} />
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    );
  };

  // ===================================================================
  //  SCHERMATA: IMPOSTAZIONI (resa inline -> i TextInput tengono il focus)
  // ===================================================================
  const renderLocalCard = () => {
    if (!LocalAsr) {
      return <Text style={[styles.body, { color: theme.muted, marginTop: 14 }]}>Non disponibile su questo dispositivo.</Text>;
    }
    const total = localStatus?.totalBytes || download.total;
    const installed = !!localStatus?.installed;
    const partial = !installed && (localStatus?.downloadedBytes || 0) > 0;
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={styles.rowBetween}>
          <View style={styles.fill}>
            <Text style={[styles.cardTitle, { color: theme.ink }]}>Parakeet Ultra</Text>
            <Text style={[styles.cardSub, { color: theme.muted }]}>moondream · 600M parametri · int8</Text>
          </View>
          <Text style={[
            styles.badge,
            installed
              ? { color: theme.teal, borderColor: theme.teal }
              : { color: theme.muted, borderColor: theme.line },
          ]}>
            {installed ? 'Pronto' : downloading ? 'In download' : 'Da scaricare'}
          </Text>
        </View>

        <Text style={[styles.body, { color: theme.inkSoft, marginTop: 12 }]}>
          Trascrive sul telefono, senza connessione e senza che l'audio esca dal dispositivo.
          Supporta l'italiano e altre 24 lingue europee.
        </Text>

        {downloading ? (
          <View style={{ marginTop: 18 }}>
            <ProgressBar theme={theme} value={download.received / (download.total || 1)} />
            <View style={[styles.rowBetween, { marginTop: 8 }]}>
              <Text style={[styles.cardSub, { color: theme.inkSoft }]}>{download.label || 'Download…'}</Text>
              <Text style={[styles.cardSub, { color: theme.ink, fontFamily: font.bold }]}>
                {formatBytes(download.received)} / {formatBytes(download.total)}
              </Text>
            </View>
            <Button theme={theme} kind="ghost" label="Annulla" onPress={() => LocalAsr.cancelDownload()} style={{ marginTop: 6 }} />
          </View>
        ) : installed ? (
          <View style={[styles.rowBetween, { marginTop: 16 }]}>
            <Text style={[styles.cardSub, { color: theme.inkSoft }]}>{formatBytes(total)} occupati sul telefono</Text>
            <Button theme={theme} kind="danger" label="Elimina" onPress={deleteLocalModel} style={{ minHeight: 40, paddingHorizontal: 8 }} />
          </View>
        ) : (
          <Button
            theme={theme}
            kind="accent"
            label={partial ? `Riprendi download · ${formatBytes(total)}` : `Scarica modello · ${formatBytes(total)}`}
            onPress={startDownload}
            style={{ marginTop: 18 }}
          />
        )}
      </View>
    );
  };

  const renderSettings = () => (
    <View style={[styles.fill, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.rowStart}>
          <RoundButton theme={theme} label="Indietro" onPress={() => setViewMode('history')}>
            <BackIcon color={theme.ink} />
          </RoundButton>
        </View>
        <Text style={[styles.screenTitle, { color: theme.ink }]}>Impostazioni</Text>

        <SectionTitle theme={theme} number="01" title="Motore" />
        <Text style={[styles.body, { color: theme.muted, marginBottom: 14 }]}>
          Chi trasforma la voce in testo.
        </Text>
        <Segmented<Engine>
          theme={theme}
          value={provider}
          onChange={setProvider}
          options={[
            { id: 'groq', label: 'Groq', sub: 'cloud' },
            { id: 'gemini', label: 'Gemini', sub: 'cloud' },
            { id: 'local', label: 'Locale', sub: 'offline' },
          ]}
        />
        <Text style={[styles.hint, { color: theme.inkSoft }]}>
          {{
            groq: 'Whisper trascrive, poi un modello linguistico aggiunge punteggiatura e paragrafi.',
            gemini: 'Gemini 3.5 Transcribe trascrive e formatta in un solo passaggio.',
            local: 'Parakeet Ultra gira sul telefono: niente rete, niente chiavi, privacy totale.',
          }[provider]}
        </Text>

        <SectionTitle theme={theme} number="02" title={ENGINE_LABELS[provider].name} />

        {provider === 'groq' && (
          <>
            <Field theme={theme} label="API key Groq" value={apiKey} onChangeText={setApiKey} placeholder="gsk_…" secureTextEntry />
            <Field theme={theme} label="Modello audio" value={whisperModel} onChangeText={setWhisperModel} />
            <Field theme={theme} label="Modello testo" value={llamaModel} onChangeText={setLlamaModel} />
          </>
        )}

        {provider === 'gemini' && (
          <>
            <Field theme={theme} label="API key Gemini" value={geminiKey} onChangeText={setGeminiKey} placeholder="AIza…" secureTextEntry hint="Si crea gratis su Google AI Studio." />
            <Field theme={theme} label="Modello" value={geminiModel} onChangeText={setGeminiModel} />

            <View style={[styles.switchRow, { borderColor: theme.line, backgroundColor: theme.surface }]}>
              <View style={[styles.fill, { paddingRight: 12 }]}>
                <Text style={[styles.cardTitleSmall, { color: theme.ink }]}>Trascrizione smart</Text>
                <Text style={[styles.cardSub, { color: theme.muted, marginTop: 3 }]}>
                  Toglie esitazioni, corregge la grammatica e applica le autocorrezioni di chi parla.
                </Text>
              </View>
              <Switch
                value={geminiSmart}
                onValueChange={setGeminiSmart}
                trackColor={{ true: theme.accent, false: theme.line }}
                thumbColor={theme.surface}
              />
            </View>

            <Text style={[styles.fieldLabel, { color: theme.muted, marginTop: 18 }]}>Lingua</Text>
            <Segmented<string>
              theme={theme}
              value={geminiLang}
              onChange={setGeminiLang}
              options={[{ id: 'auto', label: 'Rileva' }, { id: 'it-IT', label: 'Italiano' }]}
            />
            <Field
              theme={theme}
              label="Vocabolario personalizzato"
              value={geminiVocab}
              onChangeText={setGeminiVocab}
              placeholder="Nomi, termini tecnici… separati da virgola"
              multiline
              hint="Fino a 1000 termini, ma rende al meglio con un centinaio."
            />
          </>
        )}

        {provider === 'local' && renderLocalCard()}

        <SectionTitle theme={theme} number="03" title="Cronologia" />
        <Text style={[styles.body, { color: theme.muted }]}>
          {history.length} trascrizion{history.length === 1 ? 'e salvata' : 'i salvate'} sul telefono.
        </Text>
        {history.length > 0 && (
          <Button theme={theme} kind="danger" label="Elimina tutte le trascrizioni" onPress={clearAllHistory} style={{ alignSelf: 'flex-start', paddingHorizontal: 0, marginTop: 4 }} />
        )}

        <Button theme={theme} kind="ink" label="Salva" onPress={saveSettings} style={{ marginTop: 36 }} />
        <Button theme={theme} kind="ghost" label="Ripristina modelli predefiniti" onPress={resetSettings} style={{ marginTop: 6 }} />
      </ScrollView>
    </View>
  );

  // --- MAIN RENDER ---
  return (
    <>
      <StatusBar barStyle={theme.statusBar} backgroundColor={viewMode === 'reader' ? theme.surface : theme.bg} />
      {viewMode === 'settings' ? renderSettings() : viewMode === 'reader' ? renderReader() : renderHistory()}
    </>
  );
};

const App = () => (
  <SafeAreaProvider>
    <AppInner />
  </SafeAreaProvider>
);

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowStart: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  eyebrow: { fontFamily: font.bold, fontSize: 11, letterSpacing: 2 },
  wordmark: { fontFamily: font.display, fontSize: 52, lineHeight: 60, letterSpacing: -1.5, marginTop: 18 },
  subline: { fontFamily: font.semibold, fontSize: 14 },
  screenTitle: { fontFamily: font.display, fontSize: 40, lineHeight: 48, letterSpacing: -1, marginTop: 18 },

  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26, marginBottom: 12 },
  dayTitle: { fontFamily: font.serifItalic, fontSize: 19 },
  hairline: { flex: 1, height: StyleSheet.hairlineWidth },

  note: { borderWidth: 1, borderRadius: 22, padding: 18, marginBottom: 12 },
  noteTime: { fontFamily: font.bold, fontSize: 13, letterSpacing: 0.5 },
  tag: {
    fontFamily: font.bold, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase',
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden',
  },
  noteText: { fontFamily: font.serif, fontSize: 17, lineHeight: 26, marginTop: 10 },
  noteActions: {
    flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 14, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: { fontFamily: font.bold, fontSize: 13 },

  emptyQuote: { fontFamily: font.display, fontSize: 34, lineHeight: 42, letterSpacing: -0.5, marginBottom: 26 },
  step: { flexDirection: 'row', gap: 14, marginBottom: 14, alignItems: 'baseline' },
  stepNum: { fontFamily: font.serifItalic, fontSize: 16, width: 24 },
  stepText: { flex: 1, fontFamily: font.body, fontSize: 15, lineHeight: 22 },

  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },

  readerTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  readerMeta: { fontFamily: font.semibold, fontSize: 12.5, letterSpacing: 0.3 },
  accentRule: { width: 36, height: 3, borderRadius: 2, marginTop: 16, marginBottom: 22 },
  readerText: { fontFamily: font.serif, fontSize: 20, lineHeight: 32 },
  readerBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  statusText: { fontFamily: font.serifItalic, fontSize: 20, marginTop: 28, textAlign: 'center', paddingHorizontal: 30 },
  statusSub: { fontFamily: font.medium, fontSize: 13, marginTop: 8 },
  errorTitle: { fontFamily: font.display, fontSize: 26, textAlign: 'center' },
  errorText: { fontFamily: font.body, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 12 },

  body: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21 },
  hint: { fontFamily: font.body, fontSize: 13, lineHeight: 19, marginTop: 12 },
  fieldLabel: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 22, padding: 18, marginTop: 14 },
  cardTitle: { fontFamily: font.display, fontSize: 20 },
  cardTitleSmall: { fontFamily: font.bold, fontSize: 15 },
  cardSub: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 18 },
  badge: {
    fontFamily: font.bold, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase',
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 18 },
});

export default App;
