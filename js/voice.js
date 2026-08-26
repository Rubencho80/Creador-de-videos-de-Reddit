/* ===========================================================
   VOICE — motor dual: navegador (gratis) / ElevenLabs (API propia)
   =========================================================== */

const VoiceModule = {
  browserVoices: [],
  lastAudioBlob: null,   // Blob del audio generado (para export)
  lastAudioDuration: 0,  // segundos reales, tras generar

  init(){
    this.loadBrowserVoices();
    if('speechSynthesis' in window){
      window.speechSynthesis.onvoiceschanged = () => this.loadBrowserVoices();
    }
    this.bindEngineSwitch();
    this.bindControls();
    this.updateEstimate();
  },

  loadBrowserVoices(){
    if(!('speechSynthesis' in window)) return;
    this.browserVoices = window.speechSynthesis.getVoices();
    const sel = document.getElementById('sel-browser-voice');
    if(this.browserVoices.length === 0) return;

    sel.innerHTML = '';
    // Priorizar voces en español
    const sorted = [...this.browserVoices].sort((a,b) => {
      const aEs = a.lang.startsWith('es') ? 0 : 1;
      const bEs = b.lang.startsWith('es') ? 0 : 1;
      return aEs - bEs;
    });
    sorted.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(opt);
    });

    const saved = AppState.data.voice.browserVoiceURI;
    if(saved && sorted.some(v => v.voiceURI === saved)){
      sel.value = saved;
    }else{
      AppState.data.voice.browserVoiceURI = sel.value;
    }
  },

  bindEngineSwitch(){
    const sel = document.getElementById('sel-voice-engine');
    sel.value = AppState.data.voice.engine;
    this.toggleEngineBlocks(sel.value);
    sel.addEventListener('change', () => {
      AppState.data.voice.engine = sel.value;
      AppState.commit();
      this.toggleEngineBlocks(sel.value);
      this.invalidateAudio();
    });
  },

  toggleEngineBlocks(engine){
    document.getElementById('voice-block-browser').hidden = engine !== 'browser';
    document.getElementById('voice-block-eleven').hidden = engine !== 'elevenlabs';
  },

  bindControls(){
    const s = AppState.data.voice;

    const selVoice = document.getElementById('sel-browser-voice');
    selVoice.addEventListener('change', () => {
      AppState.data.voice.browserVoiceURI = selVoice.value;
      AppState.commit();
    });

    const rangeRate = document.getElementById('range-voice-rate');
    rangeRate.value = s.rate;
    document.getElementById('val-voice-rate').textContent = Number(s.rate).toFixed(2) + '×';
    rangeRate.addEventListener('input', () => {
      AppState.data.voice.rate = Number(rangeRate.value);
      document.getElementById('val-voice-rate').textContent = Number(rangeRate.value).toFixed(2) + '×';
      AppState.commit();
      this.updateEstimate();
    });

    const rangePitch = document.getElementById('range-voice-pitch');
    rangePitch.value = s.pitch;
    document.getElementById('val-voice-pitch').textContent = Number(s.pitch).toFixed(2);
    rangePitch.addEventListener('input', () => {
      AppState.data.voice.pitch = Number(rangePitch.value);
      document.getElementById('val-voice-pitch').textContent = Number(rangePitch.value).toFixed(2);
      AppState.commit();
    });

    // ElevenLabs
    const txtKey = document.getElementById('txt-eleven-key');
    txtKey.value = s.elevenKey;
    txtKey.addEventListener('input', () => { AppState.data.voice.elevenKey = txtKey.value; AppState.commit(); });

    const txtVoiceId = document.getElementById('txt-eleven-voiceid');
    txtVoiceId.value = s.elevenVoiceId;
    txtVoiceId.addEventListener('input', () => { AppState.data.voice.elevenVoiceId = txtVoiceId.value; AppState.commit(); });

    const rangeStab = document.getElementById('range-eleven-stability');
    rangeStab.value = s.elevenStability;
    document.getElementById('val-eleven-stability').textContent = s.elevenStability;
    rangeStab.addEventListener('input', () => {
      AppState.data.voice.elevenStability = Number(rangeStab.value);
      document.getElementById('val-eleven-stability').textContent = rangeStab.value;
      AppState.commit();
    });

    const rangeSim = document.getElementById('range-eleven-similarity');
    rangeSim.value = s.elevenSimilarity;
    document.getElementById('val-eleven-similarity').textContent = s.elevenSimilarity;
    rangeSim.addEventListener('input', () => {
      AppState.data.voice.elevenSimilarity = Number(rangeSim.value);
      document.getElementById('val-eleven-similarity').textContent = rangeSim.value;
      AppState.commit();
    });

    document.getElementById('btn-eleven-list').addEventListener('click', () => this.loadElevenVoices());

    document.getElementById('btn-preview-voice').addEventListener('click', () => this.previewVoice());
    document.getElementById('btn-generate-audio').addEventListener('click', () => this.generateNarrationAudio());
  },

  async loadElevenVoices(){
    const key = AppState.data.voice.elevenKey;
    if(!key){ UI.toast('Pon tu API key de ElevenLabs primero', 'err'); return; }
    try{
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': key }
      });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const sel = document.getElementById('sel-eleven-voice');
      sel.innerHTML = '';
      data.voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voice_id;
        opt.textContent = v.name;
        sel.appendChild(opt);
      });
      sel.hidden = false;
      sel.addEventListener('change', () => {
        document.getElementById('txt-eleven-voiceid').value = sel.value;
        AppState.data.voice.elevenVoiceId = sel.value;
        AppState.commit();
      });
      UI.toast(`Cargadas ${data.voices.length} voces`, 'ok');
    }catch(err){
      UI.toast('No se pudo conectar con ElevenLabs: ' + err.message, 'err');
    }
  },

  invalidateAudio(){
    if(!this.lastAudioBlob) return;
    this.lastAudioBlob = null;
    this.lastAudioDuration = 0;
    const player = document.getElementById('player-narration');
    player.hidden = true;
    document.getElementById('audio-status').textContent = 'El texto ha cambiado — vuelve a generar el audio.';
  },

  // --- estimación de duración por nº de palabras (aprox 150 palabras/min a rate=1.0) ---
  estimateSeconds(text, rate){
    const words = (text.trim().match(/\S+/g) || []).length;
    const wordsPerMinute = 150 * (rate || 1.0);
    return words > 0 ? (words / wordsPerMinute) * 60 : 0;
  },

  updateEstimate(){
    const text = AppState.data.story.text;
    const words = (text.trim().match(/\S+/g) || []).length;
    const rate = AppState.data.voice.rate;
    const secs = this.estimateSeconds(text, rate);
    document.getElementById('story-word-count').textContent =
      `${words} palabras · ≈ ${UI.formatTime(secs)} estimado`;

    const realSecs = this.lastAudioBlob ? this.lastAudioDuration : secs;
    const total = words > 0 ? realSecs + AppState.data.advanced.leadIn + AppState.data.advanced.leadOut : 0;
    const label = this.lastAudioBlob ? 'Duración' : 'Duración estimada';
    document.getElementById('preview-duration').textContent = `${label}: ${UI.formatTime(total)}`;
  },

  previewVoice(){
    const engine = AppState.data.voice.engine;
    const text = AppState.data.story.text.trim() || 'Esta es una prueba de la voz seleccionada para tu vídeo.';
    const shortText = text.split(/\s+/).slice(0, 25).join(' ');

    if(engine === 'browser'){
      this.speakBrowser(shortText);
    }else{
      UI.toast('Generando muestra con ElevenLabs...', 'info');
      this.fetchElevenAudio(shortText).then(blob => {
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
      }).catch(err => UI.toast('Error al generar la muestra: ' + err.message, 'err'));
    }
  },

  speakBrowser(text){
    if(!('speechSynthesis' in window)){
      UI.toast('Tu navegador no soporta síntesis de voz', 'err');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const uri = AppState.data.voice.browserVoiceURI;
    const voice = this.browserVoices.find(v => v.voiceURI === uri);
    if(voice) utter.voice = voice;
    utter.rate = AppState.data.voice.rate;
    utter.pitch = AppState.data.voice.pitch;
    window.speechSynthesis.speak(utter);
  },

  async fetchElevenAudio(text){
    const key = AppState.data.voice.elevenKey;
    const voiceId = AppState.data.voice.elevenVoiceId;
    if(!key) throw new Error('Falta API key');
    if(!voiceId) throw new Error('Falta Voice ID');

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: AppState.data.voice.elevenStability,
          similarity_boost: AppState.data.voice.elevenSimilarity,
        }
      })
    });
    if(!res.ok){
      const msg = await res.text().catch(()=> '');
      throw new Error(`HTTP ${res.status} ${msg.slice(0,120)}`);
    }
    return await res.blob();
  },

  // --- Generación completa del audio de narración (usado tanto para preview del reproductor como export) ---
  async generateNarrationAudio(){
    const text = AppState.data.story.text.trim();
    if(!text){
      UI.toast('Escribe primero la historia a narrar', 'err');
      return;
    }
    const statusEl = document.getElementById('audio-status');
    const engine = AppState.data.voice.engine;

    statusEl.textContent = 'Generando audio...';

    try{
      let blob;
      if(engine === 'elevenlabs'){
        blob = await this.fetchElevenAudio(text);
      }else{
        blob = await this.recordBrowserSpeech(text);
      }
      this.lastAudioBlob = blob;

      // Con el motor navegador, la propiedad _isCapturedAudio (marcada explícitamente en
      // recordBrowserSpeech) indica si se capturó audio real o si se usó el silencio de
      // respaldo. Ya no se puede distinguir por el tipo MIME: el audio real capturado también
      // puede llegar como WAV tras recortarle el margen inicial usado para esquivar el fade
      // de sistema, igual que el silencio de respaldo.
      const gotRealAudio = engine === 'elevenlabs' || blob._isCapturedAudio === true;

      const url = URL.createObjectURL(blob);
      const player = document.getElementById('player-narration');
      if(gotRealAudio){
        player.src = url;
        player.hidden = false;
      }else{
        player.hidden = true;
      }

      // medir duración real
      const dur = await this.measureBlobDuration(blob);
      this.lastAudioDuration = dur;
      if(gotRealAudio){
        statusEl.textContent = `Audio listo · duración real: ${UI.formatTime(dur)}`;
        UI.toast('Audio de narración generado', 'ok');
      }else{
        statusEl.textContent = `Silencio de temporización (${UI.formatTime(dur)}) — no se capturó audio real, ver ayuda arriba.`;
      }
      this.updateEstimate();
    }catch(err){
      statusEl.textContent = 'Error generando audio: ' + err.message;
      UI.toast('Error generando audio: ' + err.message, 'err');
    }
  },

  measureBlobDuration(blob){
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = URL.createObjectURL(blob);
      audio.onloadedmetadata = () => {
        // Chrome a veces reporta Infinity para blobs webm hasta que se busca al final
        if(isFinite(audio.duration)){
          resolve(audio.duration);
        }else{
          audio.currentTime = 1e10;
          audio.ontimeupdate = () => {
            resolve(audio.duration);
            audio.ontimeupdate = null;
          };
        }
      };
    });
  },

  // La voz del navegador (Web Speech API) sale por el audio del SISTEMA/proceso de Chrome,
  // no por el audio de la pestaña — por eso, al compartir para grabarla, hay que elegir
  // "Ventana" (esta ventana de Chrome) en el diálogo, no "Esta pestaña". "Toda la pantalla"
  // también funciona pero arrastra el audio de otras apps abiertas, así que "Ventana" es más
  // limpio. displaySurface:'window' es solo una preferencia que ayuda al navegador a proponer
  // esa opción por defecto, pero el usuario puede cambiarla en el diálogo — lo importante es
  // qué elige él ahí.
  recordBrowserSpeech(text){
    return new Promise((resolve, reject) => {
      if(!('speechSynthesis' in window)){
        reject(new Error('Tu navegador no soporta síntesis de voz'));
        return;
      }
      if(!('MediaRecorder' in window)){
        reject(new Error('Tu navegador no soporta grabación de audio (MediaRecorder)'));
        return;
      }

      const expectedSecs = this.estimateSeconds(text, AppState.data.voice.rate);
      const minAcceptableSecs = Math.max(1, expectedSecs * 0.5);

      this._recordViaDisplayMedia(text).then(async (blob) => {
        const gotDuration = await this.measureBlobDuration(blob).catch(() => 0);
        if(gotDuration < minAcceptableSecs){
          UI.toast(`La grabación capturada dura solo ${gotDuration.toFixed(1)}s para un texto que debería durar ≈${expectedSecs.toFixed(0)}s. En el diálogo tienes que elegir "Ventana" → esta ventana de Chrome (no "Esta pestaña") y marcar "Compartir audio" — la voz del navegador sale por el audio del sistema, no por el de la pestaña. Usando silencio con la duración correcta mientras tanto.`, 'info', 9000);
          this._speakForRealtime(text);
          const silent = this._silentBlob(expectedSecs);
          silent._isCapturedAudio = false;
          resolve(silent);
        }else{
          blob._isCapturedAudio = true;
          resolve(blob);
        }
      }).catch(() => {
        UI.toast('No se pudo grabar (¿cancelaste el diálogo?). Recuerda elegir "Ventana" → esta ventana de Chrome, con "Compartir audio" marcado. El vídeo tendrá la duración correcta pero en silencio.', 'info', 8000);
        this._speakForRealtime(text);
        const silent = this._silentBlob(expectedSecs);
        silent._isCapturedAudio = false;
        resolve(silent);
      });
    });
  },

  _speakForRealtime(text){
    this.speakBrowser(text);
  },

  async _recordViaDisplayMedia(text){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia){
      throw new Error('getDisplayMedia no disponible');
    }
    // displaySurface:'window' como preferencia: es la superficie de captura confirmada que
    // sí incluye el audio de speechSynthesis (que cuelga del proceso del navegador, no de la
    // pestaña) — silenciar la pestaña de Storyforge no calla esta voz, pero silenciar toda la
    // ventana/proceso de Chrome sí, lo cual delata que el sonido vive a nivel de ventana/app,
    // no de pestaña. "window" es más preciso que "monitor" (pantalla completa) porque no
    // arrastra el audio de otras aplicaciones que el usuario pueda tener abiertas a la vez.
    // No todos los navegadores respetan la preferencia, pero ayuda a Chrome a proponer
    // "Ventana" por defecto en el diálogo en vez de "Pestaña".
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window' },
      audio: true,
    });
    const audioTracks = stream.getAudioTracks();
    if(audioTracks.length === 0){
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No se compartió audio');
    }
    const audioStream = new MediaStream(audioTracks);
    const recorder = new MediaRecorder(audioStream);
    const chunks = [];
    recorder.ondataavailable = (e) => { if(e.data.size > 0) chunks.push(e.data); };

    return new Promise((resolve, reject) => {
      // Al activarse una fuente de audio nueva, varios sistemas operativos (documentado en
      // Windows, con drivers de audio modernos) aplican su propio fade-in de "calentamiento"
      // a la señal recién conectada, para evitar clics audibles — esto ocurre en el sistema,
      // no en este código, así que no se puede desactivar; solo se puede esperar a que pase.
      // Arrancamos la grabación ya (para no perder nada), pero retrasamos el inicio de la voz
      // real un poco, así ese fade de sistema recae sobre silencio y no sobre la narración,
      // y luego recortamos ese margen del resultado final para que no se note que existió.
      const systemFadeGuardMs = 400;

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const rawBlob = new Blob(chunks, { type: 'audio/webm' });
        const trimmed = await this._trimSilenceFromStart(rawBlob, systemFadeGuardMs / 1000);
        resolve(trimmed);
      };
      recorder.onerror = (e) => { stream.getTracks().forEach(t => t.stop()); reject(e); };

      // timeslice explícito: sin él, Chromium puede no entregar datos hasta el final de la
      // grabación, dejando un blob casi vacío para narraciones largas.
      recorder.start(250);
      setTimeout(() => {
        const utter = new SpeechSynthesisUtterance(text);
        const uri = AppState.data.voice.browserVoiceURI;
        const voice = this.browserVoices.find(v => v.voiceURI === uri);
        if(voice) utter.voice = voice;
        utter.rate = AppState.data.voice.rate;
        utter.pitch = AppState.data.voice.pitch;
        utter.onend = () => setTimeout(() => recorder.stop(), 300);
        utter.onerror = () => setTimeout(() => recorder.stop(), 300);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      }, systemFadeGuardMs);
    });
  },

  _silentBlob(seconds){
    // Genera un WAV silencioso de la duración estimada usando un AudioContext offline,
    // así el pipeline de export siempre tiene un audio con la duración correcta.
    const sampleRate = 44100;
    const frameCount = Math.max(1, Math.floor(sampleRate * seconds));
    const buffer = new ArrayBuffer(44 + frameCount * 2);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => { for(let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + frameCount * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, frameCount * 2, true);
    return new Blob([buffer], { type: 'audio/wav' });
  },

  // Decodifica un blob de audio, descarta los primeros `trimSeconds` del contenido, y
  // devuelve el resto reencodificado como WAV. Se usa tras capturar voz vía getDisplayMedia,
  // donde se introduce deliberadamente un margen inicial de silencio para esquivar el fade-in
  // que algunos sistemas operativos aplican al activar una fuente de audio nueva — este
  // recorte hace que ese margen quede fuera del resultado, sin que el resto del pipeline
  // (que asume que la voz empieza en el instante 0 del blob) note que existió.
  async _trimSilenceFromStart(blob, trimSeconds){
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try{
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const sampleRate = decoded.sampleRate;
      const trimFrames = Math.min(decoded.length, Math.floor(trimSeconds * sampleRate));
      const remainingFrames = decoded.length - trimFrames;
      if(remainingFrames <= 0) return blob; // el recorte se comería todo el audio, no tocar

      const numChannels = decoded.numberOfChannels;
      // mezclar a mono para el WAV de salida (coherente con _silentBlob, que también es mono)
      const mono = new Float32Array(remainingFrames);
      for(let ch = 0; ch < numChannels; ch++){
        const channelData = decoded.getChannelData(ch);
        for(let i = 0; i < remainingFrames; i++){
          mono[i] += channelData[trimFrames + i] / numChannels;
        }
      }

      const buffer = new ArrayBuffer(44 + remainingFrames * 2);
      const view = new DataView(buffer);
      const writeStr = (offset, str) => { for(let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + remainingFrames * 2, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, 'data');
      view.setUint32(40, remainingFrames * 2, true);
      for(let i = 0; i < remainingFrames; i++){
        const s = Math.max(-1, Math.min(1, mono[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      return new Blob([buffer], { type: 'audio/wav' });
    }catch(e){
      // si el recorte falla por lo que sea, devolver el blob original sin tocar antes que
      // perder el audio grabado por un error al reprocesarlo.
      console.warn('No se pudo recortar el margen inicial de silencio:', e.message);
      return blob;
    }finally{
      audioCtx.close().catch(()=>{});
    }
  }
};
