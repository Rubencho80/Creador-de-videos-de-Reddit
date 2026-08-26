/* ===========================================================
   STATE — fuente única de verdad + persistencia
   =========================================================== */

const STORAGE_KEY = 'storyforge_settings_v1';
const TEMPLATES_KEY = 'storyforge_templates_v1';

// Estado por defecto. bgVideo NO se persiste (demasiado pesado para localStorage),
// solo su nombre para mostrarlo.
function defaultState(){
  return {
    bg: {
      fileName: null,
      mute: true,
      fit: 'cover',
      dim: 35,
    },
    card: {
      avatarDataUrl: null,
      username: 'u/historia_anonima',
      subreddit: 'r/AmITheAsshole',
      time: 'hace 8 h',
      title: 'AITA por decirle a mi hermana que su boda "sorpresa" en mi cumpleaños no era ninguna sorpresa agradable',
      votes: '12,4 k',
      comments: '1,2 k',
      percent: '94%',
      width: 88,
      offsetY: 0,
      theme: 'dark',
    },
    story: {
      text: '',
    },
    voice: {
      engine: 'browser',
      browserVoiceURI: null,
      rate: 1.0,
      pitch: 1.0,
      elevenKey: '',
      elevenVoiceId: '',
      elevenStability: 0.5,
      elevenSimilarity: 0.75,
    },
    advanced: {
      aspect: '9:16',
      exportQuality: 'full',
      leadIn: 0,
      leadOut: 1.0,
      fadeAudio: true,
    },
    ia: {
      ollamaUrl: 'http://localhost:11434',
      model: null,
      tema: '',
      subredditStyle: 'AmITheAsshole',
      tono: 'dramatico',
      words: 450,
      primeraPersona: true,
      giro: true,
      outSubreddit: '',
      outTitle: '',
      outStory: '',
    },
    youtube: {
      clientId: '',
    },
  };
}

const AppState = {
  data: defaultState(),
  _listeners: [],

  init(){
    const saved = localStorage.getItem(STORAGE_KEY);
    if(saved){
      try{
        const parsed = JSON.parse(saved);
        this.data = deepMerge(defaultState(), parsed);
      }catch(e){
        console.warn('No se pudo leer ajustes guardados, usando por defecto', e);
        this.data = defaultState();
      }
    }
  },

  save(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    }catch(e){
      console.warn('No se pudo guardar en localStorage', e);
    }
  },

  onChange(fn){ this._listeners.push(fn); },

  notify(){
    this._listeners.forEach(fn => fn(this.data));
  },

  // Llamar tras cualquier mutación de this.data
  commit(){
    this.save();
    this.notify();
  }
};

function deepMerge(base, override){
  const out = Array.isArray(base) ? [...base] : {...base};
  for(const key in override){
    if(override[key] && typeof override[key] === 'object' && !Array.isArray(override[key]) && base[key] && typeof base[key] === 'object'){
      out[key] = deepMerge(base[key], override[key]);
    }else{
      out[key] = override[key];
    }
  }
  return out;
}

/* ---------- Plantillas ---------- */
const Templates = {
  list(){
    try{
      return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]');
    }catch(e){ return []; }
  },
  save(name, data){
    const templates = this.list();
    const entry = {
      id: 'tpl_' + Date.now(),
      name,
      createdAt: new Date().toISOString(),
      data: JSON.parse(JSON.stringify(data)),
    };
    templates.push(entry);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
    return entry;
  },
  remove(id){
    const templates = this.list().filter(t => t.id !== id);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  },
  setAll(templates){
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }
};
