import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, FlatList, Alert, useColorScheme, StatusBar
} from 'react-native';
import ShareMenu from 'react-native-share-menu';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Clipboard from '@react-native-clipboard/clipboard';
// ABBIAMO RIMOSSO BLURVIEW PER ORA PERCHÉ CAUSA L'INVISIBILITÀ

// --- CONFIGURAZIONE ---
const DEFAULT_WHISPER_MODEL = 'whisper-large-v3';
const DEFAULT_LLAMA_MODEL = 'llama-3.3-70b-versatile'; 
const DEFAULT_API_KEY = 'INSERISCI_QUI_LA_TUA_CHIAVE_GROQ'; 

const App = () => {
  const systemScheme = useColorScheme();
  const isDarkMode = systemScheme === 'dark';

  // --- STATI APP ---
  const [sharedData, setSharedData] = useState(null);
  const [transcription, setTranscription] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [viewMode, setViewMode] = useState('history'); 
  
  // --- STATI IMPOSTAZIONI ---
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [whisperModel, setWhisperModel] = useState(DEFAULT_WHISPER_MODEL);
  const [llamaModel, setLlamaModel] = useState(DEFAULT_LLAMA_MODEL);

  // --- TEMI SICURI (Colori solidi per evitare trasparenze errate) ---
  const theme = {
    // Forziamo un colore solido per il menu principale
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
        loadSettingsAndProcess(item.data);
      }
    };
    ShareMenu.getInitialShare(handleShare);
    const listener = ShareMenu.addNewShareListener(handleShare);
    return () => listener.remove();
  }, []);

  const loadData = async () => {
    try {
      const jsonHistory = await AsyncStorage.getItem('@history');
      if (jsonHistory != null) setHistory(JSON.parse(jsonHistory));
      const savedKey = await AsyncStorage.getItem('@api_key');
      if (savedKey) setApiKey(savedKey);
    } catch(e) {}
  };

  const loadSettingsAndProcess = async (uri) => {
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
    Alert.alert("Salvataggio", "Impostazioni aggiornate.");
  };

  const resetSettings = () => {
      setWhisperModel(DEFAULT_WHISPER_MODEL);
      setLlamaModel(DEFAULT_LLAMA_MODEL);
      Alert.alert("Ripristinato", "Modelli ripristinati.");
  };

  const processAudio = async (uri, keyToUse, whisperToUse, llamaToUse) => {
    setLoading(true);
    setTranscription('Trascrizione in corso...');
    try {
      let cleanUri = uri;
      if (!cleanUri.startsWith('file://') && !cleanUri.startsWith('content://')) {
          cleanUri = 'file://' + cleanUri;
      }
      const fileData = { uri: cleanUri, type: 'audio/ogg', name: 'audio.ogg' };

      const formData = new FormData();
      formData.append('file', fileData);
      formData.append('model', whisperToUse); 
      formData.append('prompt', 'Testo in italiano.'); 

      const transRes = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
        headers: { 'Authorization': `Bearer ${keyToUse}`, 'Content-Type': 'multipart/form-data' },
      });

      const rawText = transRes.data.text;
      if (rawText.length < 10) { finishProcess(rawText); return; }

      setTranscription(`Formattazione con ${llamaToUse}...`); 
      const chatRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: llamaToUse, 
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
      if (error.response && error.response.data && error.response.data.error) errorMsg = JSON.stringify(error.response.data.error); 
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
              <TextInput style={[styles.input, {backgroundColor: theme.inputBg, color: theme.text}]} value={apiKey} onChangeText={setApiKey} placeholder="gsk_..." secureTextEntry />
              <Text style={[styles.label, {color: theme.subText}]}>Modello Audio</Text>
              <TextInput style={[styles.input, {backgroundColor: theme.inputBg, color: theme.text}]} value={whisperModel} onChangeText={setWhisperModel} />
              <Text style={[styles.label, {color: theme.subText}]}>Modello Testo</Text>
              <TextInput style={[styles.input, {backgroundColor: theme.inputBg, color: theme.text}]} value={llamaModel} onChangeText={setLlamaModel} />
              <TouchableOpacity onPress={resetSettings} style={{marginBottom: 20}}>
                  <Text style={{color: theme.action, textAlign:'right'}}>Ripristina Default</Text>
              </TouchableOpacity>
              <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                  <TouchableOpacity onPress={() => setViewMode('history')} style={styles.cancelButton}><Text style={{color: theme.subText}}>Annulla</Text></TouchableOpacity>
                  <TouchableOpacity onPress={saveSettings} style={styles.saveButton}><Text style={styles.saveButtonText}>Salva</Text></TouchableOpacity>
              </View>
          </View>
      </View>
  );

  // --- MODAL SIMULATED GLASS (Più opaco e senza BlurView per sicurezza) ---
  const ReaderModal = () => {
    const glassTheme = {
      // Usiamo il 95% di opacità invece del 45% per garantire che si veda
      tint: isDarkMode ? 'rgba(30, 32, 40, 0.95)' : 'rgba(255, 255, 255, 0.95)',
      border: isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(200, 200, 200, 0.5)',
      text: isDarkMode ? '#FFFFFF' : '#000000',
      icon: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'
    };

    return (
      <View style={styles.bottomModalContainer}>
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
          <View style={styles.backdrop} />
          <TouchableOpacity style={styles.transparentArea} onPress={() => setViewMode('history')} />
          
          {/* Card senza BlurView ma con colore semi-trasparente solido */}
          <View style={[styles.glassCard, { borderColor: glassTheme.border, backgroundColor: glassTheme.tint }]}>
              
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

              {/* Contenuto */}
              {loading ? (
                <View style={styles.centerContent}>
                  <ActivityIndicator size="large" color={theme.success} />
                  <Text style={{marginTop: 15, color: glassTheme.text}}>{transcription}</Text>
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
    );
  };

  // --- MAIN RENDER ---
  if (viewMode === 'settings') return <SettingsScreen />;
  if (viewMode === 'overlay' || viewMode === 'reader') return <ReaderModal />;

  return (
    <View style={[styles.historyContainer, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      
      <View style={styles.mainHeaderRow}>
          <Text style={[styles.historyHeader, { color: theme.text }]}>AudioScribe</Text>
          <View style={{flexDirection:'row', gap: 20, alignItems:'center'}}>
              {history.length > 0 && (
                  <TouchableOpacity onPress={clearAllHistory}>
                      <Text style={{fontSize: 20}}>🗑️</Text>
                  </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setViewMode('settings')}>
                  <Text style={{fontSize: 24}}>⚙️</Text>
              </TouchableOpacity>
          </View>
      </View>

      <FlatList
        data={history}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={<Text style={{textAlign:'center', marginTop:50, color: theme.subText}}>Nessuna trascrizione.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={[styles.historyItem, { backgroundColor: theme.card }]}
            onPress={() => { setTranscription(item.text); setViewMode('reader'); }}
          >
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8}}>
                <Text style={[styles.historyDate, { color: theme.subText }]}>{item.date}</Text>
                <View style={{flexDirection: 'row', gap: 15}}>
                    <TouchableOpacity onPress={() => copyText(item.text)}>
                        <Text style={{color: theme.action, fontSize:12, fontWeight:'bold'}}>COPIA</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteItem(item.id)}>
                        <Text style={{color: theme.danger, fontSize:12, fontWeight:'bold'}}>ELIMINA</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <Text style={[styles.historyText, { color: theme.text }]} numberOfLines={3}>{item.text}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  overlayContainer: { flex: 1, justifyContent: 'center', padding: 20 },
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
  label: { fontSize: 12, fontWeight: 'bold', marginTop: 10, marginBottom: 5 },
  input: { padding: 10, borderRadius: 8, fontSize: 16, marginBottom: 5 },
  saveButton: { backgroundColor: '#25D366', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  saveButtonText: { color: 'white', fontWeight: 'bold' },
  cancelButton: { paddingVertical: 10, paddingHorizontal: 20 },
  
  // STILI VETRO SICURO
  bottomModalContainer: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  glassCard: { 
    borderTopLeftRadius: 25, borderTopRightRadius: 25, 
    height: '75%', width: '100%', 
    padding: 25,
    borderWidth: 1.5, borderBottomWidth: 0,
    elevation: 20 
  },
});

export default App;