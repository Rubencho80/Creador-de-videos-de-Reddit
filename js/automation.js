/* ===========================================================
   AUTOMATION — modo automático: repite el flujo IA→render N veces
   =========================================================== */

const AutomationModule = {
  running: false,
  stopRequested: false,
  countdownTimer: null,
  results: [], // { id, index, status, videoBlob, duration, title, subreddit, error }

  init(){
    this.bindConfig();
    document.getElementById('btn-auto-start').addEventListener('click', () => this.start());
    document.getElementById('btn-auto-stop').addEventListener('click', () => this.requestStop());
    document.getElementById('btn-auto-skip-wait').addEventListener('click', () => this.skipWait());

    // refrescar el estado de los requisitos cada vez que se entra a la pestaña o cambia algo
    AppState.onChange(() => this.refreshRequirements());
    document.querySelector('.ttab[data-panel="panel-auto"]').addEventListener('click', () => this.refreshRequirements());
    this.refreshRequirements();
  },

  bindConfig(){
    const rangeCount = document.getElementById('range-auto-count');
    document.getElementById('val-auto-count').textContent = rangeCount.value;
    rangeCount.addEventListener('input', () => {
      document.getElementById('val-auto-count').textContent = rangeCount.value;
    });

    const rangeInterval = document.getElementById('range-auto-interval');
    const fmtInterval = (v) => Number(v) === 0 ? '0 min (sin espera)' : `${v} min`;
    document.getElementById('val-auto-interval').textContent = fmtInterval(rangeInterval.value);
    rangeInterval.addEventListener('input', () => {
      document.getElementById('val-auto-interval').textContent = fmtInterval(rangeInterval.value);
    });
  },

  refreshRequirements(){
    const ollamaOk = !!AppState.data.ia.model && OllamaModule.connected;
    const bgOk = !!window._bgVideoFile;

    const setReq = (id, ok, okText, offText) => {
      const el = document.getElementById(id);
      el.innerHTML = `<span class="dot ${ok ? 'dot-ok' : 'dot-off'}"></span> ${ok ? okText : offText}`;
    };
    setReq('auto-req-ollama', ollamaOk, 'Ollama conectado con un modelo elegido', 'Ollama conectado con un modelo elegido');
    setReq('auto-req-bg', bgOk, 'Vídeo de fondo cargado', 'Vídeo de fondo cargado');
  },

  canStart(){
    if(!AppState.data.ia.model || !OllamaModule.connected){
      UI.toast('Conecta con Ollama y elige un modelo antes de arrancar el lote', 'err');
      return false;
    }
    if(!window._bgVideoFile){
      UI.toast('Sube un vídeo de fondo antes de arrancar el lote', 'err');
      return false;
    }
    if(location.protocol === 'file:'){
      UI.toast('Estás abriendo el archivo directamente (file://) — sirve la carpeta con un servidor local antes de usar el modo automático (ver ayuda en Exportar).', 'err', 8000);
      return false;
    }
    if(!AppState.data.ia.tema.trim()){
      UI.toast('No has puesto ningún tema en "Guion con IA" — todas las historias del lote saldrán genéricas y parecidas entre sí. Puedes seguir igualmente si eso es lo que quieres.', 'info', 7000);
    }
    return true;
  },

  async start(){
    if(this.running) return;
    if(!this.canStart()) return;

    this.running = true;
    this.stopRequested = false;
    this.results = [];
    document.getElementById('btn-auto-start').hidden = true;
    document.getElementById('btn-auto-stop').hidden = false;
    document.getElementById('auto-progress').hidden = false;
    document.getElementById('auto-log').innerHTML = '';

    const count = Number(document.getElementById('range-auto-count').value);
    const intervalMin = Number(document.getElementById('range-auto-interval').value);
    const uploadToYoutube = document.getElementById('chk-auto-upload-yt').checked;
    const varyFreely = document.getElementById('chk-auto-vary-subreddit').checked;

    if(uploadToYoutube && !YouTubeModule.accessToken){
      UI.toast('Has marcado subir a YouTube automáticamente, pero la cuenta no está conectada todavía. Conéctala primero desde el editor, o desmarca esa opción.', 'err', 8000);
      this._finish();
      return;
    }

    for(let i = 0; i < count; i++){
      if(this.stopRequested){
        this._logSystem(`Detenido por el usuario tras ${i} vídeo(s).`);
        break;
      }

      const entry = { id: 'auto_' + Date.now() + '_' + i, index: i, status: 'running' };
      this.results.push(entry);
      this._renderLogItem(entry);
      this._setBatchProgress(i, count, 'Generando historia con la IA...');

      try{
        // 1. Generar con la IA (estilo/tono libres si el usuario lo pidió, para variedad)
        const styleOverride = varyFreely ? 'custom' : null;
        const tonoOverride = varyFreely ? 'custom' : null;
        const { subreddit, title } = await OllamaModule.generateAllPure(
          (pct, label) => this._setBatchProgress(i, count, label),
          styleOverride, tonoOverride
        );
        entry.subreddit = subreddit;
        entry.title = title;

        if(this.stopRequested) throw new Error('Detenido por el usuario');

        // 2. Aplicar a la tarjeta/narración sin cambiar de pestaña
        const applied = OllamaModule.applyToCard(true);
        if(!applied) throw new Error('La IA no devolvió contenido para aplicar');

        // 3. Renderizar el vídeo (produceVideo ya genera el audio si hace falta)
        this._setBatchProgress(i, count, 'Renderizando vídeo...');
        const { videoBlob, totalDuration } = await ExportModule.produceVideo(
          (pct, label) => this._setBatchProgress(i, count, `Renderizando: ${label}`)
        );
        entry.videoBlob = videoBlob;
        entry.duration = totalDuration;
        entry.status = 'ok';
        this._renderLogItem(entry);

        // 4. Subida a YouTube opcional
        if(uploadToYoutube){
          this._setBatchProgress(i, count, 'Subiendo a YouTube...');
          try{
            await YouTubeModule.uploadBlob(videoBlob, title || AppState.data.card.title, '', totalDuration);
            entry.uploaded = true;
          }catch(uploadErr){
            entry.uploadError = uploadErr.message;
          }
          this._renderLogItem(entry);
        }

      }catch(err){
        console.error('Fallo en vídeo automático', i, err);
        entry.status = 'err';
        entry.error = err.message;
        this._renderLogItem(entry);
        // según lo decidido: saltar al siguiente intento, no parar el lote entero
      }

      const isLast = i === count - 1;
      if(!isLast && !this.stopRequested){
        if(intervalMin > 0){
          await this._wait(intervalMin * 60);
        }
      }
    }

    this._finish();
  },

  requestStop(){
    this.stopRequested = true;
    document.getElementById('btn-auto-stop').disabled = true;
    document.getElementById('btn-auto-stop').textContent = 'Deteniendo tras esta vuelta...';
  },

  skipWait(){
    if(this._waitResolve) this._waitResolve();
  },

  _wait(totalSeconds){
    return new Promise((resolve) => {
      this._waitResolve = () => {
        clearInterval(this.countdownTimer);
        document.getElementById('auto-countdown').hidden = true;
        resolve();
      };
      let remaining = totalSeconds;
      const countdownEl = document.getElementById('auto-countdown');
      const timeEl = document.getElementById('auto-countdown-time');
      countdownEl.hidden = false;
      timeEl.textContent = UI.formatTime(remaining);
      this.countdownTimer = setInterval(() => {
        if(this.stopRequested){ this._waitResolve(); return; }
        remaining -= 1;
        timeEl.textContent = UI.formatTime(Math.max(0, remaining));
        if(remaining <= 0) this._waitResolve();
      }, 1000);
    });
  },

  _finish(){
    this.running = false;
    this.stopRequested = false;
    document.getElementById('btn-auto-start').hidden = false;
    document.getElementById('btn-auto-stop').hidden = true;
    document.getElementById('btn-auto-stop').disabled = false;
    document.getElementById('btn-auto-stop').textContent = '⏹ Detener tras esta vuelta';
    document.getElementById('auto-progress').hidden = true;
    document.getElementById('auto-countdown').hidden = true;

    const okCount = this.results.filter(r => r.status === 'ok').length;
    const errCount = this.results.filter(r => r.status === 'err').length;
    if(this.results.length > 0){
      UI.toast(`Lote terminado: ${okCount} vídeo(s) generado(s)${errCount ? `, ${errCount} fallido(s)` : ''}`, errCount ? 'info' : 'ok');
    }
  },

  _setBatchProgress(currentIndex, total, label){
    const pct = Math.round(((currentIndex) / total) * 100);
    document.getElementById('auto-progress-fill').style.width = pct + '%';
    document.getElementById('auto-progress-label').textContent = `Vídeo ${currentIndex + 1} de ${total} · ${label}`;
  },

  _logSystem(text){
    const log = document.getElementById('auto-log');
    if(log.querySelector('.field-hint')) log.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'field-hint';
    p.textContent = text;
    log.appendChild(p);
  },

  _renderLogItem(entry){
    const log = document.getElementById('auto-log');
    if(log.querySelector('.field-hint') && !log.querySelector(`[data-entry="${entry.id}"]`)){
      log.innerHTML = '';
    }

    let el = log.querySelector(`[data-entry="${entry.id}"]`);
    if(!el){
      el = document.createElement('div');
      el.dataset.entry = entry.id;
      log.appendChild(el);
    }

    el.className = `auto-log-item status-${entry.status}`;
    const statusLabel = entry.status === 'running' ? 'Generando...' : entry.status === 'ok' ? 'Listo' : 'Error';
    const titleLine = entry.title ? this._truncate(entry.title, 70) : (entry.status === 'running' ? 'Esperando resultado de la IA...' : '');

    let actionsHtml = '';
    if(entry.status === 'ok' && entry.videoBlob){
      const url = URL.createObjectURL(entry.videoBlob);
      actionsHtml = `<a class="btn btn-secondary btn-sm" href="${url}" download="storyforge-auto-${entry.index + 1}.webm">Descargar</a>`;
      if(entry.uploaded){
        actionsHtml += `<span class="field-hint" style="align-self:center;">✓ Subido a YouTube</span>`;
      }else if(entry.uploadError){
        actionsHtml += `<span class="field-hint" style="align-self:center;color:#e8524a;">Fallo al subir: ${this._truncate(entry.uploadError, 40)}</span>`;
      }else{
        actionsHtml += `<button class="btn btn-secondary btn-sm" data-action="upload-yt" data-entry="${entry.id}">Subir a YouTube</button>`;
      }
    }

    el.innerHTML = `
      <div class="auto-log-head">
        <span>Vídeo ${entry.index + 1}${entry.duration ? ' · ' + UI.formatTime(entry.duration) : ''}</span>
        <span>${statusLabel}</span>
      </div>
      ${titleLine ? `<div class="auto-log-title">${this._escapeHtml(titleLine)}</div>` : ''}
      ${entry.status === 'err' ? `<div class="auto-log-title" style="color:#e8524a;">${this._escapeHtml(entry.error || 'Error desconocido')}</div>` : ''}
      ${actionsHtml ? `<div class="auto-log-actions">${actionsHtml}</div>` : ''}
    `;

    const uploadBtn = el.querySelector('[data-action="upload-yt"]');
    if(uploadBtn){
      uploadBtn.addEventListener('click', async () => {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Subiendo...';
        try{
          await YouTubeModule.uploadBlob(entry.videoBlob, entry.title || AppState.data.card.title, '', entry.duration);
          entry.uploaded = true;
        }catch(err){
          entry.uploadError = err.message;
        }
        this._renderLogItem(entry);
      });
    }
  },

  _truncate(str, n){
    return str.length > n ? str.slice(0, n) + '…' : str;
  },

  _escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
