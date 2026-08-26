/* ===========================================================
   OLLAMA — conexión local + generación de guion en 3 pasos
   =========================================================== */

const OllamaModule = {
  connected: false,

  init(){
    this.bindConnection();
    this.bindGenerationForm();
    this.bindGenerateButtons();
    this.bindOutputPanel();
  },

  bindConnection(){
    const txtUrl = document.getElementById('txt-ollama-url');
    txtUrl.value = AppState.data.ia.ollamaUrl;
    txtUrl.addEventListener('input', () => {
      AppState.data.ia.ollamaUrl = txtUrl.value;
      AppState.commit();
    });

    document.getElementById('btn-ollama-connect').addEventListener('click', () => this.connect());
  },

  async connect(){
    const url = AppState.data.ia.ollamaUrl.replace(/\/+$/, '');
    const statusEl = document.getElementById('ollama-status');
    statusEl.innerHTML = `<span class="dot dot-off"></span> Conectando...`;

    try{
      const res = await fetch(`${url}/api/tags`);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const models = data.models || [];

      if(models.length === 0){
        statusEl.innerHTML = `<span class="dot dot-err"></span> Conectado, pero no hay modelos instalados`;
        UI.toast('Ollama responde pero no tienes modelos. Prueba: ollama pull llama3.2', 'err');
        return;
      }

      const sel = document.getElementById('sel-ollama-model');
      sel.innerHTML = '';
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        sel.appendChild(opt);
      });
      sel.disabled = false;

      if(AppState.data.ia.model && models.some(m => m.name === AppState.data.ia.model)){
        sel.value = AppState.data.ia.model;
      }else{
        AppState.data.ia.model = sel.value;
      }
      sel.addEventListener('change', () => {
        AppState.data.ia.model = sel.value;
        AppState.commit();
      });

      this.connected = true;
      statusEl.innerHTML = `<span class="dot dot-ok"></span> Conectado · ${models.length} modelo(s)`;
      AppState.commit();
      UI.toast('Conectado a Ollama', 'ok');
    }catch(err){
      this.connected = false;
      statusEl.innerHTML = `<span class="dot dot-err"></span> No se pudo conectar`;
      UI.toast('No se pudo conectar a Ollama. Revisa la ayuda de CORS de abajo.', 'err');
    }
  },

  bindGenerationForm(){
    const s = AppState.data.ia;

    document.getElementById('txt-ia-tema').value = s.tema;
    document.getElementById('txt-ia-tema').addEventListener('input', (e) => {
      AppState.data.ia.tema = e.target.value; AppState.commit();
    });

    document.getElementById('sel-ia-subreddit-style').value = s.subredditStyle;
    document.getElementById('sel-ia-subreddit-style').addEventListener('change', (e) => {
      AppState.data.ia.subredditStyle = e.target.value; AppState.commit();
    });

    document.getElementById('sel-ia-tono').value = s.tono;
    document.getElementById('sel-ia-tono').addEventListener('change', (e) => {
      AppState.data.ia.tono = e.target.value; AppState.commit();
    });

    const rangeWords = document.getElementById('range-ia-words');
    rangeWords.value = s.words;
    const updateWordsLabel = () => {
      document.getElementById('val-ia-words').textContent = rangeWords.value + ' palabras';
      const secs = VoiceModule.estimateSeconds('x '.repeat(Number(rangeWords.value)), AppState.data.voice.rate);
      document.getElementById('ia-words-estimate').textContent = `≈ ${UI.formatTime(secs)} de narración a velocidad normal`;
    };
    updateWordsLabel();
    rangeWords.addEventListener('input', () => {
      AppState.data.ia.words = Number(rangeWords.value);
      AppState.commit();
      updateWordsLabel();
    });

    document.getElementById('chk-ia-primera-persona').checked = s.primeraPersona;
    document.getElementById('chk-ia-primera-persona').addEventListener('change', (e) => {
      AppState.data.ia.primeraPersona = e.target.checked; AppState.commit();
    });

    document.getElementById('chk-ia-giro').checked = s.giro;
    document.getElementById('chk-ia-giro').addEventListener('change', (e) => {
      AppState.data.ia.giro = e.target.checked; AppState.commit();
    });
  },

  /* ---------------------------------------------------------
     PROMPTS INTERNOS
     Cada pieza se pide en un mensaje separado, siempre con la
     instrucción explícita de no escribir nada que no sea el
     texto final (sin "Aquí tienes...", sin comillas envolventes,
     sin markdown, sin explicaciones).
     --------------------------------------------------------- */
  _styleLabel(style){
    const map = {
      AmITheAsshole: 'AITA (Am I The Asshole): un dilema moral donde el narrador cuenta una situación y pide que se juzgue si actuó mal o no',
      relationship_advice: 'relationship_advice: un conflicto o drama de pareja/familia donde se pide consejo',
      revenge: 'ProRevenge o PettyRevenge: una historia de venganza contra alguien que hizo algo mal al narrador',
      tifu: 'TIFU (Today I F***ed Up): el narrador cuenta una cagada propia, con tono más ligero o cómico',
      confession: 'confession: una confesión seria de algo que el narrador hizo o vivió',
      custom: 'el estilo de subreddit (AITA, relationship_advice, revenge, TIFU, confession, u otro) que mejor encaje con el tema dado, decidido por ti a partir de ese tema',
    };
    return map[style] || map.custom;
  },

  _toneLabel(tone){
    const map = {
      dramatico: 'dramático, con tensión emocional',
      comico: 'cómico, con humor y ligereza',
      tenso: 'tenso, con suspense creciente',
      emotivo: 'emotivo, apelando a los sentimientos del lector',
      custom: 'el tono (dramático, cómico, tenso o emotivo, u otro que encaje) que mejor se ajuste al tema dado, decidido por ti a partir de ese tema',
    };
    return map[tone] || map.dramatico;
  },

  _systemPreamble(){
    return `Eres un guionista experto en historias virales de Reddit para vídeos cortos de redes sociales (TikTok, Reels, Shorts). Trabajas en español. Sigue las instrucciones al pie de la letra. NUNCA añadas texto de relleno, saludos, explicaciones, comillas envolventes, ni frases como "Aquí tienes", "Claro, aquí está" o similares. Responde ÚNICAMENTE con el contenido pedido, sin nada más, sin formato markdown, sin asteriscos, sin encabezados.`;
  },

  async chat(prompt){
    const url = AppState.data.ia.ollamaUrl.replace(/\/+$/, '');
    const model = AppState.data.ia.model;
    if(!model) throw new Error('No hay modelo seleccionado. Conecta con Ollama primero.');

    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: this._systemPreamble() },
          { role: 'user', content: prompt },
        ]
      })
    });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.message && data.message.content || '').trim();
  },

  buildSubredditPrompt(){
    const s = AppState.data.ia;
    return `Dame un nombre de subreddit realista y coherente con este tipo de historia: ${this._styleLabel(s.subredditStyle)}. Tema de la historia: "${s.tema || 'una historia interesante y creíble'}". Escribe solo el nombre, en formato "r/NombreDelSubreddit", una sola línea, nada más.`;
  },

  buildTitlePrompt(subreddit){
    const s = AppState.data.ia;
    return `Escribe SOLO el título de una publicación de Reddit para el subreddit ${subreddit || this._styleLabel(s.subredditStyle)}, tema: "${s.tema || 'una historia interesante y creíble'}", tono ${this._toneLabel(s.tono)}. El título debe ser largo (entre 15 y 30 palabras), enganchar desde la primera palabra, generar curiosidad inmediata, y sonar exactamente como un título real de Reddit (puede incluir siglas como AITA, UPDATE, etc si encajan). No pongas comillas alrededor. Escribe solo el título, una sola vez, nada más.`;
  },

  buildStoryPrompt(subreddit, title){
    const s = AppState.data.ia;
    const persona = s.primeraPersona ? 'en primera persona, como si el narrador viviera la historia' : 'en tercera persona';
    const giro = s.giro ? ' La historia debe incluir un giro o remate inesperado hacia el final que sorprenda al oyente.' : '';
    return `Escribe SOLO el cuerpo completo de la historia de Reddit para esta publicación:
Subreddit: ${subreddit}
Título: ${title}
Tono: ${this._toneLabel(s.tono)}
Narración: ${persona}.
Extensión: aproximadamente ${s.words} palabras (puedes variar un 10% arriba o abajo, pero no te quedes corto).${giro}
Esta historia se usará ÚNICAMENTE como guion de audio narrado, así que escribe en prosa fluida y natural para ser leída en voz alta, con frases que suenen bien al hablarlas. No la dividas en apartados ni pongas títulos internos. No repitas el título al principio. Empieza directamente contando la historia.`;
  },

  bindGenerateButtons(){
    document.getElementById('btn-ia-generate-all').addEventListener('click', () => this.generateAll());
    document.getElementById('btn-ia-generate-title').addEventListener('click', () => this.generateTitleOnly());
    document.getElementById('btn-ia-generate-story').addEventListener('click', () => this.generateStoryOnly());
  },

  _setProgress(pct, label){
    const wrap = document.getElementById('ia-progress');
    wrap.hidden = pct === null;
    if(pct !== null) document.getElementById('ia-progress-fill').style.width = pct + '%';
    document.getElementById('ia-progress-label').textContent = label;
  },

  async generateAll(){
    if(!AppState.data.ia.model){
      UI.toast('Conecta con Ollama y elige un modelo primero', 'err');
      return;
    }
    const btn = document.getElementById('btn-ia-generate-all');
    btn.disabled = true;
    try{
      await this.generateAllPure((pct, label) => this._setProgress(pct, label));
      setTimeout(() => this._setProgress(null, ''), 900);
      UI.toast('Historia generada. Revísala en "Guion con IA" y pulsa Aplicar.', 'ok');
      UI.showIaOutputTab();
    }catch(err){
      this._setProgress(null, '');
      UI.toast('Error generando con Ollama: ' + err.message, 'err');
    }finally{
      btn.disabled = false;
    }
  },

  // Lógica de negocio pura: pide subreddit + título + historia y los deja escritos en los
  // campos de salida. No cambia de pestaña ni traga errores (los relanza siempre), para que
  // tanto el botón manual como el modo automático puedan reaccionar según corresponda.
  // subredditStyleOverride/tonoOverride, si se pasan, sustituyen temporalmente los ajustes
  // guardados (usado por el modo automático cuando "dejar elegir a la IA" está activado).
  async generateAllPure(onProgress, subredditStyleOverride, tonoOverride){
    const report = onProgress || (() => {});
    const originalStyle = AppState.data.ia.subredditStyle;
    const originalTono = AppState.data.ia.tono;
    if(subredditStyleOverride) AppState.data.ia.subredditStyle = subredditStyleOverride;
    if(tonoOverride) AppState.data.ia.tono = tonoOverride;

    try{
      report(10, 'Generando subreddit...');
      const subreddit = await this.chat(this.buildSubredditPrompt());
      document.getElementById('txt-ia-out-subreddit').value = subreddit;

      report(40, 'Generando título...');
      const title = await this.chat(this.buildTitlePrompt(subreddit));
      document.getElementById('txt-ia-out-title').value = title;

      report(65, 'Generando historia (puede tardar)...');
      const story = await this.chat(this.buildStoryPrompt(subreddit, title));
      document.getElementById('txt-ia-out-story').value = story;
      this.updateOutWordCount();

      report(100, 'Listo');
      return { subreddit, title, story };
    }finally{
      AppState.data.ia.subredditStyle = originalStyle;
      AppState.data.ia.tono = originalTono;
    }
  },

  async generateTitleOnly(){
    if(!AppState.data.ia.model){ UI.toast('Conecta con Ollama primero', 'err'); return; }
    try{
      this._setProgress(30, 'Generando título...');
      const subreddit = document.getElementById('txt-ia-out-subreddit').value || this._styleLabel(AppState.data.ia.subredditStyle);
      const title = await this.chat(this.buildTitlePrompt(subreddit));
      document.getElementById('txt-ia-out-title').value = title;
      this._setProgress(100, 'Listo');
      setTimeout(() => this._setProgress(null, ''), 700);
      UI.showIaOutputTab();
    }catch(err){
      this._setProgress(null, '');
      UI.toast('Error: ' + err.message, 'err');
    }
  },

  async generateStoryOnly(){
    if(!AppState.data.ia.model){ UI.toast('Conecta con Ollama primero', 'err'); return; }
    try{
      this._setProgress(30, 'Generando historia...');
      const subreddit = document.getElementById('txt-ia-out-subreddit').value || this._styleLabel(AppState.data.ia.subredditStyle);
      const title = document.getElementById('txt-ia-out-title').value || AppState.data.card.title;
      const story = await this.chat(this.buildStoryPrompt(subreddit, title));
      document.getElementById('txt-ia-out-story').value = story;
      this.updateOutWordCount();
      this._setProgress(100, 'Listo');
      setTimeout(() => this._setProgress(null, ''), 700);
      UI.showIaOutputTab();
    }catch(err){
      this._setProgress(null, '');
      UI.toast('Error: ' + err.message, 'err');
    }
  },

  updateOutWordCount(){
    const text = document.getElementById('txt-ia-out-story').value;
    const words = (text.trim().match(/\S+/g) || []).length;
    document.getElementById('ia-out-word-count').textContent = words + ' palabras';
  },

  bindOutputPanel(){
    const s = AppState.data.ia;
    document.getElementById('txt-ia-out-subreddit').value = s.outSubreddit;
    document.getElementById('txt-ia-out-title').value = s.outTitle;
    document.getElementById('txt-ia-out-story').value = s.outStory;
    this.updateOutWordCount();

    document.getElementById('txt-ia-out-subreddit').addEventListener('input', (e) => {
      AppState.data.ia.outSubreddit = e.target.value; AppState.commit();
    });
    document.getElementById('txt-ia-out-title').addEventListener('input', (e) => {
      AppState.data.ia.outTitle = e.target.value; AppState.commit();
    });
    document.getElementById('txt-ia-out-story').addEventListener('input', (e) => {
      AppState.data.ia.outStory = e.target.value;
      AppState.commit();
      this.updateOutWordCount();
    });

    document.getElementById('btn-ia-apply').addEventListener('click', () => this.applyToCard());
  },

  applyToCard(silent){
    const subreddit = document.getElementById('txt-ia-out-subreddit').value.trim();
    const title = document.getElementById('txt-ia-out-title').value.trim();
    const story = document.getElementById('txt-ia-out-story').value.trim();

    if(!subreddit && !title && !story){
      if(!silent) UI.toast('No hay nada que aplicar todavía', 'err');
      return false;
    }

    if(subreddit) AppState.data.card.subreddit = subreddit;
    if(title) AppState.data.card.title = title;
    if(story) AppState.data.story.text = story;
    AppState.commit();

    // Refrescar inputs visibles del editor manual
    document.getElementById('txt-subreddit').value = AppState.data.card.subreddit;
    document.getElementById('txt-title').value = AppState.data.card.title;
    document.getElementById('val-title-count').textContent = AppState.data.card.title.length + ' car.';
    document.getElementById('txt-story').value = AppState.data.story.text;
    VoiceModule.invalidateAudio();
    VoiceModule.updateEstimate();

    if(silent) return true;

    UI.toast('Aplicado a la tarjeta y la narración', 'ok');

    // Llevar al usuario al editor para que vea el resultado en el preview
    document.querySelector('.ttab[data-panel="panel-editor"]').click();
    return true;
  }
};
