/* ===========================================================
   MAIN — arranque de la app
   =========================================================== */

document.addEventListener('DOMContentLoaded', () => {
  AppState.init();

  UI.initTabs();
  UI.initModalCloses();

  RedditCard.bindInputs();
  RedditCard.render();

  VoiceModule.init();
  OllamaModule.init();
  TemplatesModule.init();
  ExportModule.init();
  YouTubeModule.init();
  AutomationModule.init();

  // pre-cachear avatar para el render de canvas al exportar
  AppState.onChange(() => ExportModule.preloadAvatar());
  ExportModule.preloadAvatar();

  // botón vaciar todo
  document.getElementById('btn-reset').addEventListener('click', () => {
    if(!confirm('Esto borrará todos los ajustes actuales (no las plantillas guardadas). ¿Seguro?')) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  // reproducción de la previsualización (fondo en bucle + tarjeta ya se ve estática; el botón
  // simplemente reproduce el vídeo de fondo y sincroniza una barra de tiempo aproximada)
  const btnPlay = document.getElementById('btn-play-preview');
  const bgVideo = document.getElementById('preview-bg-video');
  const transportBar = document.getElementById('transport-bar');
  const transportFill = document.getElementById('transport-fill');
  const transportTime = document.getElementById('transport-time');

  let previewTimer = null;
  let elapsedTime = 0;   // posición actual en segundos, única fuente de verdad
  let isDragging = false;

  const iconPlay = '<svg viewBox="0 0 20 20" fill="currentColor" width="16"><path d="M6 4l10 6-10 6V4z"/></svg>';
  const iconPause = '<svg viewBox="0 0 20 20" fill="currentColor" width="16"><rect x="5" y="4" width="4" height="12"/><rect x="11" y="4" width="4" height="12"/></svg>';

  function storySeconds(){
    return VoiceModule.lastAudioBlob
      ? VoiceModule.lastAudioDuration
      : VoiceModule.estimateSeconds(AppState.data.story.text, AppState.data.voice.rate);
  }

  function totalDuration(){
    return AppState.data.advanced.leadIn + storySeconds() + AppState.data.advanced.leadOut;
  }

  // Pinta la barra y el contador de tiempo a partir de elapsedTime. Toda actualización visual
  // pasa por aquí, así el arrastre y el reloj automático nunca se desincronizan entre sí.
  function renderTransport(){
    const total = totalDuration();
    const pct = total > 0 ? Math.min(100, (elapsedTime / total) * 100) : 0;
    transportFill.style.width = pct + '%';
    transportTime.textContent = `${UI.formatTime(elapsedTime)} / ${UI.formatTime(total)}`;
  }

  // Sincroniza el vídeo de fondo (que va en bucle y puede ser más corto que la duración total)
  // con la posición lógica actual, sin dejar que currentTime salga de rango.
  function syncBgVideoTo(seconds){
    if(!bgVideo.duration || !isFinite(bgVideo.duration)) return;
    bgVideo.currentTime = Math.min(bgVideo.duration, Math.max(0, seconds % bgVideo.duration));
  }

  function pausePreview(){
    bgVideo.pause();
    btnPlay.innerHTML = iconPlay;
    clearInterval(previewTimer);
    previewTimer = null;
  }

  function startPreviewClock(){
    clearInterval(previewTimer);
    previewTimer = setInterval(() => {
      if(isDragging) return; // mientras se arrastra, el tiempo lo manda el usuario, no el reloj
      elapsedTime += 0.2;
      const total = totalDuration();
      if(elapsedTime >= total){
        elapsedTime = total;
        renderTransport();
        pausePreview();
        return;
      }
      renderTransport();
    }, 200);
  }

  btnPlay.addEventListener('click', () => {
    if(bgVideo.paused){
      // si ya habíamos llegado al final, reiniciar desde el principio al volver a pulsar play
      if(elapsedTime >= totalDuration()) elapsedTime = 0;
      syncBgVideoTo(elapsedTime);
      bgVideo.play().catch(() => {});
      btnPlay.innerHTML = iconPause;
      startPreviewClock();
    }else{
      pausePreview();
    }
  });

  // --- arrastre real de la barra: mousedown/touchstart inicia, mousemove/touchmove actualiza
  // en vivo mientras se mantiene pulsado (incluso si el cursor sale de la barra), y mouseup/
  // touchend confirma la posición final. Cubre tanto un solo click como un arrastre completo. ---
  function positionFromEvent(e){
    const rect = transportBar.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return pct * totalDuration();
  }

  function beginDrag(e){
    isDragging = true;
    elapsedTime = positionFromEvent(e);
    renderTransport();
    syncBgVideoTo(elapsedTime);
    e.preventDefault();
  }

  function updateDrag(e){
    if(!isDragging) return;
    elapsedTime = positionFromEvent(e);
    renderTransport();
  }

  function endDrag(){
    if(!isDragging) return;
    isDragging = false;
    syncBgVideoTo(elapsedTime);
    // si se soltó al final del todo, comportarse igual que si hubiera terminado solo
    if(elapsedTime >= totalDuration()) pausePreview();
  }

  transportBar.addEventListener('mousedown', beginDrag);
  transportBar.addEventListener('touchstart', beginDrag, { passive: false });
  window.addEventListener('mousemove', updateDrag);
  window.addEventListener('touchmove', updateDrag, { passive: false });
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('touchend', endDrag);

  renderTransport();
  VoiceModule.updateEstimate();
});
