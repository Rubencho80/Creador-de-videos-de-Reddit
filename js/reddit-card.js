/* ===========================================================
   REDDIT CARD — pinta la tarjeta y engancha los inputs manuales
   =========================================================== */

const RedditCard = {

  render(){
    const s = AppState.data;

    const card = document.getElementById('reddit-card');
    card.classList.toggle('theme-light', s.card.theme === 'light');
    card.style.width = s.card.width + '%';
    card.style.top = (50 + (s.card.offsetY || 0)) + '%';

    document.getElementById('rc-username').textContent = s.card.username || 'u/anonimo';
    document.getElementById('rc-subreddit').textContent = s.card.subreddit || 'r/historias';
    document.getElementById('rc-time').textContent = s.card.time || '';
    document.getElementById('rc-title').textContent = s.card.title || '';
    document.getElementById('rc-votes-num').textContent = s.card.votes || '0';
    document.getElementById('rc-percent').textContent = '· ' + (s.card.percent || '0%');
    document.getElementById('rc-comments-num').textContent = s.card.comments || '0';

    const avatarEl = document.getElementById('rc-avatar');
    if(s.card.avatarDataUrl){
      avatarEl.style.backgroundImage = `url(${s.card.avatarDataUrl})`;
    }else{
      avatarEl.style.backgroundImage = '';
    }

    // Fondo: dim, fit
    document.getElementById('canvas-dim').style.opacity = (s.bg.dim / 100).toFixed(2);
    const video = document.getElementById('preview-bg-video');
    video.style.objectFit = s.bg.fit;
    video.muted = s.bg.mute;

    // Aspect ratio del canvas
    document.getElementById('canvas-frame').dataset.aspect = s.advanced.aspect;

    // Panel lateral: reflejar avatar en el mini preview del acordeón
    const avatarPreview = document.getElementById('avatar-preview');
    if(s.card.avatarDataUrl){
      avatarPreview.style.backgroundImage = `url(${s.card.avatarDataUrl})`;
    }else{
      avatarPreview.style.backgroundImage = '';
    }
  },

  bindInputs(){
    const s = AppState.data;

    // ---- helpers ----
    const bindText = (id, path, cb) => {
      const el = document.getElementById(id);
      el.value = getPath(s, path);
      el.addEventListener('input', () => {
        setPath(AppState.data, path, el.value);
        AppState.commit();
        if(cb) cb();
      });
    };
    const bindCheck = (id, path) => {
      const el = document.getElementById(id);
      el.checked = getPath(s, path);
      el.addEventListener('change', () => {
        setPath(AppState.data, path, el.checked);
        AppState.commit();
      });
    };
    const bindRange = (id, path, valEl, fmt) => {
      const el = document.getElementById(id);
      el.value = getPath(s, path);
      if(valEl) document.getElementById(valEl).textContent = fmt(el.value);
      el.addEventListener('input', () => {
        setPath(AppState.data, path, Number(el.value));
        if(valEl) document.getElementById(valEl).textContent = fmt(el.value);
        AppState.commit();
      });
    };
    const bindSelect = (id, path) => {
      const el = document.getElementById(id);
      el.value = getPath(s, path);
      el.addEventListener('change', () => {
        setPath(AppState.data, path, el.value);
        AppState.commit();
      });
    };

    // ---- Tarjeta ----
    bindText('txt-username', 'card.username');
    bindText('txt-subreddit', 'card.subreddit');
    bindText('txt-time', 'card.time');
    bindText('txt-votes', 'card.votes');
    bindText('txt-comments', 'card.comments');
    bindText('txt-percent', 'card.percent');
    bindSelect('sel-card-theme', 'card.theme');
    bindRange('range-card-width', 'card.width', 'val-card-width', v => v + '%');

    const rangeOffset = document.getElementById('range-card-offset');
    rangeOffset.value = s.card.offsetY || 0;
    const fmtOffset = v => Number(v) === 0 ? 'Centro' : (Number(v) > 0 ? `+${v}% ↓` : `${v}% ↑`);
    document.getElementById('val-card-offset').textContent = fmtOffset(rangeOffset.value);
    rangeOffset.addEventListener('input', () => {
      AppState.data.card.offsetY = Number(rangeOffset.value);
      document.getElementById('val-card-offset').textContent = fmtOffset(rangeOffset.value);
      AppState.commit();
    });

    const titleEl = document.getElementById('txt-title');
    titleEl.value = s.card.title;
    document.getElementById('val-title-count').textContent = titleEl.value.length + ' car.';
    titleEl.addEventListener('input', () => {
      AppState.data.card.title = titleEl.value;
      document.getElementById('val-title-count').textContent = titleEl.value.length + ' car.';
      AppState.commit();
    });

    // ---- Fondo ----
    bindCheck('chk-bg-mute', 'bg.mute');
    bindSelect('sel-bg-fit', 'bg.fit');
    bindRange('range-bg-dim', 'bg.dim', 'val-bg-dim', v => v + '%');

    // ---- Avanzado ----
    bindSelect('sel-aspect', 'advanced.aspect');
    bindSelect('sel-export-quality', 'advanced.exportQuality');
    document.getElementById('num-lead-in').value = s.advanced.leadIn;
    document.getElementById('num-lead-in').addEventListener('input', (e) => {
      AppState.data.advanced.leadIn = Number(e.target.value) || 0;
      AppState.commit();
      VoiceModule.updateEstimate();
    });
    document.getElementById('num-lead-out').value = s.advanced.leadOut;
    document.getElementById('num-lead-out').addEventListener('input', (e) => {
      AppState.data.advanced.leadOut = Number(e.target.value) || 0;
      AppState.commit();
      VoiceModule.updateEstimate();
    });
    bindCheck('chk-fade-audio', 'advanced.fadeAudio');

    // ---- Historia (narración) ----
    const storyEl = document.getElementById('txt-story');
    storyEl.value = s.story.text;
    storyEl.addEventListener('input', () => {
      AppState.data.story.text = storyEl.value;
      AppState.commit();
      VoiceModule.invalidateAudio();
      VoiceModule.updateEstimate();
    });

    // ---- Avatar upload ----
    document.getElementById('input-avatar').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        AppState.data.card.avatarDataUrl = reader.result;
        AppState.commit();
        RedditCard.render();
      };
      reader.readAsDataURL(file);
    });

    // ---- Fondo de vídeo: subida + drag&drop ----
    const dropZone = document.getElementById('drop-bg');
    const inputBg = document.getElementById('input-bg-video');

    const handleBgFile = (file) => {
      if(!file || !file.type.startsWith('video/')){
        UI.toast('Eso no parece un archivo de vídeo', 'err');
        return;
      }
      const url = URL.createObjectURL(file);
      const video = document.getElementById('preview-bg-video');
      video.src = url;
      video.play().catch(()=>{});
      AppState.data.bg.fileName = file.name;
      window._bgVideoFile = file; // no persistido, solo en memoria para exportar
      document.getElementById('bg-drop-label').textContent = file.name;
      AppState.commit();
    };

    inputBg.addEventListener('change', (e) => handleBgFile(e.target.files[0]));

    ['dragenter','dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('is-dragover'); });
    });
    ['dragleave','drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('is-dragover'); });
    });
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      handleBgFile(file);
    });

    // Toggle zonas seguras
    document.getElementById('btn-toggle-safe').addEventListener('click', () => {
      const el = document.getElementById('safe-zones');
      el.hidden = !el.hidden;
    });

    AppState.onChange(() => RedditCard.render());
  }
};

/* helpers de rutas tipo "card.username" */
function getPath(obj, path){
  return path.split('.').reduce((o,k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value){
  const keys = path.split('.');
  let cur = obj;
  for(let i=0;i<keys.length-1;i++) cur = cur[keys[i]];
  cur[keys[keys.length-1]] = value;
}
