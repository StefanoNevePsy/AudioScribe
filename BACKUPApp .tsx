import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, FlatList, Alert, useColorScheme, StatusBar, Modal
} from 'react-native';
import ShareMenu from 'react-native-share-menu';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Clipboard from '@react-native-clipboard/clipboard';
import { BlurView } from "@react-native-community/blur";

// --- VALORI DI DEFAULT (Fallback) ---
const DEFAULT_WHISPER_MODEL = 'whisper-large-v3';
const DEFAULT_LLAMA_MODEL = 'llama-3.3-70b-versatile'; 
// Chiave di default (vuota o la tua hardcoded se preferisci)
const DEFAULT_API_KEY = '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'; 

const App = () => {
  const systemScheme = useColorScheme();
  const isDarkMode = systemScheme === 'dark';

  // --- STATI APP ---
  const [sharedData, setSharedData] = useState(null);
  const [transcription, setTranscription] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [viewMode, setViewMode] = useState('history'); // 'history', 'overlay', 'reader', 'settings'

  // --- STATI IMPOSTAZIONI ---
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [whisperModel, setWhisperModel] = useState(DEFAULT_WHISPER_MODEL);
  const [llamaModel, setLlamaModel] = useState(DEFAULT_LLAMA_MODEL);

  // --- TEMI ---
  const theme = {
    bg: isDarkMode ? '#121212' : '#f0f2f5',
    card: isDarkMode ? '#1F2C34' : '#ffffff',
    text: isDarkMode ? '#E9EDEF' : '#111b21',
    subText: isDarkMode ? '#8696a0' : '#667781',
    overlay: isDarkMode ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.5)',
    border: isDarkMode ? '#2A3942' : '#e9edef',
    inputBg: isDarkMode ? '#2A3942' : '#e9edef',
    danger: '#ef5350',
    action: '#007AFF',
    success: '#25D366'
  };

  useEffect(() => {
    loadData();
    
    const handleShare = (item) => {
      if (item && item.data) {
        setSharedData(item);
        setViewMode('overlay');
        // Usiamo i valori attuali dello state (che potrebbero non essere ancora caricati se l'app parte da freddo)
        // Per sicurezza carichiamo e poi proccessiamo
        loadSettingsAndProcess(item.data);
      }
    };
    
    ShareMenu.getInitialShare(handleShare);
    const listener = ShareMenu.addNewShareListener(handleShare);
    return () => listener.remove();
  }, []);

  const loadData = async () => {
    try {
      // Carica Storia
      const jsonHistory = await AsyncStorage.getItem('@history');
      if (jsonHistory != null) setHistory(JSON.parse(jsonHistory));

      // Carica Impostazioni
      const savedKey = await AsyncStorage.getItem('@api_key');
      const savedWhisper = await AsyncStorage.getItem('@whisper_model');
      const savedLlama = await AsyncStorage.getItem('@llama_model');

      if (savedKey) setApiKey(savedKey);
      if (savedWhisper) setWhisperModel(savedWhisper);
      if (savedLlama) setLlamaModel(savedLlama);
    } catch(e) {}
  };

  // Funzione speciale per caricare settings prima di processare se l'app è fredda
  const loadSettingsAndProcess = async (uri) => {
      try {
        const savedKey = await AsyncStorage.getItem('@api_key');
        const savedWhisper = await AsyncStorage.getItem('@whisper_model');
        const savedLlama = await AsyncStorage.getItem('@llama_model');
        
        // Determina quali valori usare (salvati o correnti/default)
        const activeKey = savedKey || apiKey;
        const activeWhisper = savedWhisper || whisperModel;
        const activeLlama = savedLlama || llamaModel;

        // Aggiorna lo stato UI
        setApiKey(activeKey);
        setWhisperModel(activeWhisper);
        setLlamaModel(activeLlama);

        // Avvia processo passando i parametri esplicitamente
        processAudio(uri, activeKey, activeWhisper, activeLlama);
      } catch (e) {
          processAudio(uri, apiKey, whisperModel, llamaModel);
      }
  };

  const saveSettings = async () => {
    await AsyncStorage.setItem('@api_key', apiKey);
    await AsyncStorage.setItem('@whisper_model', whisperModel);
    await AsyncStorage.setItem('@llama_model', llamaModel);
    setViewMode('history');
    Alert.alert("Salvataggio", "Impostazioni aggiornate.");
  };

  const resetSettings = () => {
      setWhisperModel(DEFAULT_WHISPER_MODEL);
      setLlamaModel(DEFAULT_LLAMA_MODEL);
      Alert.alert("Ripristinato", "Modelli ripristinati ai valori di default.");
  };

  // --- LOGICA TRASCRIZIONE ---
  const processAudio = async (uri, keyToUse, whisperToUse, llamaToUse) => {
    setLoading(true);
    setTranscription('Trascrizione in corso...');
    
    try {
      let cleanUri = uri;
      if (!cleanUri.startsWith('file://') && !cleanUri.startsWith('content://')) {
          cleanUri = 'file://' + cleanUri;
      }

      const fileData = { uri: cleanUri, type: 'audio/ogg', name: 'audio.ogg' };

      // --- FASE 1: WHISPER ---
      const formData = new FormData();
      formData.append('file', fileData);
      formData.append('model', whisperToUse); // Usa variabile dinamica
      formData.append('prompt', 'Testo in italiano.'); 

      const transRes = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
        headers: { 'Authorization': `Bearer ${keyToUse}`, 'Content-Type': 'multipart/form-data' },
      });

      const rawText = transRes.data.text;
      if (rawText.length < 10) {
        finishProcess(rawText);
        return;
      }

      // --- FASE 2: LLAMA ---
      setTranscription(`Formattazione con ${llamaToUse}...`); 
      const chatRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: llamaToUse, // Usa variabile dinamica
        messages: [
          { role: "system", content: "Formatta il seguente testo parlato: aggiungi punteggiatura, maiuscole e dividi in paragrafi. Non cambiare le parole." },
          { role: "user", content: rawText }
        ]
      }, {
        headers: { 'Authorization': `Bearer ${keyToUse}`, 'Content-Type': 'application/json' },
      });

      finishProcess(chatRes.data.choices[0].message.content);

    } catch (error) {
      let errorMsg = error.message;
      if (error.response && error.response.data && error.response.data.error) {
          errorMsg = JSON.stringify(error.response.data.error); 
      }
      setTranscription('Errore: ' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const finishProcess = async (text) => {
      setTranscription(text);
      const newItem = { id: Date.now().toString(), text, date: new Date().toLocaleString() };
      const newHistory = [newItem, ...history];
      setHistory(newHistory);
      await AsyncStorage.setItem('@history', JSON.stringify(newHistory));
  };

  const copyText = (text) => {
    Clipboard.setString(text);
    Alert.alert("Copiato", "Testo copiato negli appunti.");
  };

  const deleteItem = (id) => {
    Alert.alert("Elimina", "Vuoi cancellare questa trascrizione?", [
        { text: "Annulla", style: "cancel" },
        { text: "Elimina", style: 'destructive', onPress: async () => {
            const newHistory = history.filter(item => item.id !== id);
            setHistory(newHistory);
            await AsyncStorage.setItem('@history', JSON.stringify(newHistory));
            if(viewMode === 'reader') setViewMode('history');
        }}
      ]);
  };

  const clearAllHistory = () => {
    Alert.alert("Attenzione", "Eliminare TUTTO?", [
        { text: "Annulla", style: "cancel" },
        { text: "ELIMINA", style: 'destructive', onPress: async () => {
            setHistory([]);
            await AsyncStorage.setItem('@history', JSON.stringify([]));
        }}
    ]);
  };

  // --- UI COMPONENTS ---

  const SettingsScreen = () => (
      <View style={[styles.overlayContainer, { backgroundColor: theme.overlay }]}>
          <View style={[styles.card, { backgroundColor: theme.card, height: 'auto' }]}>
              <Text style={[styles.title, { color: theme.text, marginBottom: 20 }]}>Impostazioni</Text>

              <Text style={[styles.label, {color: theme.subText}]}>API Key Groq</Text>
              <TextInput 
                style={[styles.input, {backgroundColor: theme.inputBg, color: theme.text}]}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="gsk_..."
                secureTextEntry
              />

              <Text style={[styles.label, {color: theme.subText}]}>Modello Audio (Whisper)</Text>
              <TextInput 
                style={[styles.input, {backgroundColor: theme.inputBg, color: theme.text}]}
                value={whisperModel}
                onChangeText={setWhisperModel}
              />

              <Text style={[styles.label, {color: theme.subText}]}>Modello Testo (Llama)</Text>
              <TextInput 
                style={[styles.input, {backgroundColor: theme.inputBg, color: theme.text}]}
                value={llamaModel}
                onChangeText={setLlamaModel}
              />

              <TouchableOpacity onPress={resetSettings} style={{marginBottom: 20}}>
                  <Text style={{color: theme.action, textAlign:'right'}}>Ripristina Default</Text>
              </TouchableOpacity>

              <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                  <TouchableOpacity onPress={() => setViewMode('history')} style={styles.cancelButton}>
                      <Text style={{color: theme.subText}}>Annulla</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={saveSettings} style={styles.saveButton}>
                      <Text style={styles.saveButtonText}>Salva</Text>
                  </TouchableOpacity>
              </View>
          </View>
      </View>
  );

  // --- COMPONENTE: MODALE GLASS DESIGN ---
  const ReaderModal = () => {
    // Colori specifici per l'effetto vetro liquido
    const glassTheme = {
      // Tinta di fondo: Bianco latte (giorno) o Grigio scuro (notte), molto trasparenti
      tint: isDarkMode ? 'rgba(30, 32, 40, 0.5)' : 'rgba(255, 255, 255, 0.45)',
      // Bordo sottile semi-trasparente per dare "spessore"
      border: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.5)',
      text: isDarkMode ? '#FFFFFF' : '#000000',
      icon: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'
    };

    return (
      <View style={styles.bottomModalContainer}>
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
          
          {/* Sfondo scuro semitrasparente dietro al vetro per dare contrasto */}
          <View style={styles.backdrop} />
          
          <TouchableOpacity style={styles.transparentArea} onPress={() => setViewMode('history')} />
          
          <View style={[styles.glassCard, { borderColor: glassTheme.border }]}>
            {/* IL BLUR: Questo crea l'effetto sfocato */}
            <BlurView
              style={styles.absoluteBlur}
              blurType={isDarkMode ? "dark" : "light"}
              blurAmount={25}
              reducedTransparencyFallbackColor={isDarkMode ? "#1F2C34" : "white"}
            />

            {/* LIVELLO COLORE: Tinta sopra il blur per leggibilità */}
            <View style={[styles.glassContent, { backgroundColor: glassTheme.tint }]}>
              
              {/* Header */}
              <View style={[styles.cardHeader, { borderBottomColor: glassTheme.border }]}>
                <Text style={[styles.title, { color: glassTheme.text }]}>Trascrizione</Text>
                <View style={{flexDirection: 'row', gap: 15}}>
                    {!loading && (
                        <TouchableOpacity onPress={() => copyText(transcription)}>
                            <Text style={{color: theme.action, fontWeight: 'bold'}}>COPIA</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setViewMode('history')}>
                        <Text style={{color: glassTheme.icon, fontSize: 18, fontWeight: 'bold'}}>✕</Text>
                    </TouchableOpacity>
                </View>
              </View>

              {/* Contenuto Testo */}
              {loading ? (
                <View style={styles.centerContent}>
                  <ActivityIndicator size="large" color={theme.success} />
                  <Text style={{marginTop: 15, color: glassTheme.text, opacity: 0.8}}>{transcription}</Text>
                </View>
              ) : (
                <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
                  <Text style={[styles.resultText, { color: glassTheme.text }]} selectable={true}>
                    {transcription}
                  </Text>
                </ScrollView>
              )}
            </View>
          </View>
      </View>
    );
  };
};
const styles = StyleSheet.create({
  // --- STILI ESISTENTI (Impostazioni e Cronologia) ---
  overlayContainer: { flex: 1, justifyContent: 'center', padding: 20 }, // Per le Impostazioni (Centro)
  transparentArea: { flex: 1 },
  card: { borderRadius: 20, padding: 20, elevation: 10, width: '100%', maxHeight:'80%' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottomWidth: 0.5 },
  title: { fontSize: 18, fontWeight: 'bold' },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  resultText: { fontSize: 16, lineHeight: 24 },
  
  historyContainer: { flex: 1, padding: 20 },
  mainHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, marginBottom: 20 },
  historyHeader: { fontSize: 26, fontWeight: 'bold' },
  historyItem: { padding: 16, borderRadius: 12, marginBottom: 12, elevation: 1 },
  historyDate: { fontSize: 12, fontWeight: '600' },
  historyText: { fontSize: 14, lineHeight: 20 },

  // Settings Styles
  label: { fontSize: 12, fontWeight: 'bold', marginTop: 10, marginBottom: 5 },
  input: { padding: 10, borderRadius: 8, fontSize: 16, marginBottom: 5 },
  saveButton: { backgroundColor: '#25D366', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  saveButtonText: { color: 'white', fontWeight: 'bold' },
  cancelButton: { paddingVertical: 10, paddingHorizontal: 20 },

  // --- NUOVI STILI PER LIQUID GLASS (Aggiunti qui sotto) ---
  
  // 1. Contenitore specifico per il vetro (lo allinea in BASSO, non al centro)
  bottomModalContainer: { 
    flex: 1, 
    justifyContent: 'flex-end',
  },
  
  // 2. Sfondo scuro dietro il vetro
  backdrop: {
    ...StyleSheet.absoluteFillObject, // Copre tutto lo schermo
    backgroundColor: 'rgba(0,0,0,0.3)', 
  },

  // 3. La card di vetro esterna (contiene il blur)
  glassCard: { 
    borderTopLeftRadius: 25, 
    borderTopRightRadius: 25, 
    height: '75%', 
    width: '100%',
    overflow: 'hidden', // IMPORTANTE: Taglia il blur ai bordi
    borderWidth: 1.5,
    borderBottomWidth: 0,
    elevation: 20, 
  },

  // 4. Posiziona il blur a tutto schermo dentro la card
  absoluteBlur: {
    position: "absolute",
    top: 0, left: 0, bottom: 0, right: 0,
  },

  // 5. Contenitore interno per testo e pulsanti (sopra il blur)
  glassContent: {
    flex: 1,
    padding: 25, 
  },
});

export default App;