/* ===========================================================
   YOUTUBE — OAuth (Google Identity Services) + subida directa
   Requiere que el usuario configure su propio Client ID de
   Google Cloud con la YouTube Data API v3 activada.
   =========================================================== */

const YouTubeModule = {
  accessToken: null,
  tokenClient: null,

  init(){
    document.getElementById('btn-yt-connect').addEventListener('click', () => UI.openModal('modal-youtube'));
    document.getElementById('modal-youtube-close').addEventListener('click', () => UI.closeModal('modal-youtube'));

    document.getElementById('txt-yt-clientid').value = AppState.data.youtube.clientId;
    document.getElementById('btn-yt-save-setup').addEventListener('click', () => this.saveClientId());
    document.getElementById('btn-yt-do-upload').addEventListener('click', () => this.authenticateAndUpload());
    document.getElementById('btn-yt-upload').addEventListener('click', () => UI.openModal('modal-youtube'));

    // Prefill del título con el de la tarjeta
    AppState.onChange(() => {
      const yttitle = document.getElementById('txt-yt-title');
      if(!yttitle.value) yttitle.value = AppState.data.card.title.slice(0,95);
    });
  },

  saveClientId(){
    const id = document.getElementById('txt-yt-clientid').value.trim();
    if(!id){ UI.toast('Pega tu Client ID primero', 'err'); return; }
    AppState.data.youtube.clientId = id;
    AppState.commit();
    UI.toast('Client ID guardado', 'ok');
  },

  ensureTokenClient(){
    if(!window.google || !google.accounts || !google.accounts.oauth2){
      throw new Error('La librería de Google no ha cargado (revisa tu conexión a internet)');
    }
    const clientId = AppState.data.youtube.clientId;
    if(!clientId) throw new Error('Falta el Client ID de Google. Configúralo en "Conectar YouTube".');

    if(!this.tokenClient || this._lastClientId !== clientId){
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/youtube.upload',
        callback: () => {}, // se sobreescribe por llamada
      });
      this._lastClientId = clientId;
    }
    return this.tokenClient;
  },

  async authenticateAndUpload(){
    if(!window._lastExportedBlob){
      UI.toast('Primero exporta el vídeo (botón "Exportar vídeo")', 'err');
      return;
    }

    let client;
    try{
      client = this.ensureTokenClient();
    }catch(err){
      UI.toast(err.message, 'err');
      return;
    }

    UI.toast('Abriendo inicio de sesión de Google...', 'info');

    client.callback = async (resp) => {
      if(resp.error){
        UI.toast('Error de autenticación: ' + resp.error, 'err');
        return;
      }
      this.accessToken = resp.access_token;
      document.getElementById('yt-conn-label').textContent = 'YouTube conectado';
      document.getElementById('btn-yt-upload').disabled = false;
      UI.closeModal('modal-youtube');
      await this.doUpload();
    };
    client.requestAccessToken();
  },

  async doUpload(){
    const title = document.getElementById('txt-yt-title').value.trim() || AppState.data.card.title.slice(0,95);
    const desc = document.getElementById('txt-yt-desc').value.trim();
    const blob = window._lastExportedBlob;

    UI.toast('Subiendo vídeo a YouTube...', 'info');
    try{
      const result = await this.uploadBlob(blob, title, desc, window._lastExportedDuration);
      UI.toast('¡Vídeo subido a YouTube!', 'ok');
      if(result.id) UI.toast(`Enlace: https://youtu.be/${result.id}`, 'ok');
    }catch(err){
      UI.toast('Error subiendo a YouTube: ' + err.message, 'err');
    }
  },

  // Lógica de negocio pura: sube un blob de vídeo dado con el título/descripción indicados.
  // No lee nada del DOM del modal ni traga errores (los relanza siempre) — usada tanto por
  // doUpload (flujo manual del modal) como por el modo automático para cada vídeo del lote.
  // Requiere que ya exista un accessToken válido (obtenido vía authenticateAndUpload).
  // durationSeconds es opcional; si no se pasa, se usa window._lastExportedDuration como
  // respaldo (así el flujo manual, que sí deja esa variable actualizada, sigue funcionando
  // sin cambios), pero cualquier llamador que tenga la duración a mano — como el modo
  // automático — debería pasarla explícitamente para que la detección de Short sea fiable.
  async uploadBlob(blob, title, description, durationSeconds){
    if(!blob) throw new Error('No hay vídeo para subir');
    if(!this.accessToken) throw new Error('Cuenta de YouTube no conectada');

    const privacy = document.getElementById('sel-yt-privacy').value;
    const duration = durationSeconds != null ? durationSeconds : (window._lastExportedDuration || 0);

    // YouTube no tiene ningún campo para "marcar" un vídeo como Short: lo decide él mismo,
    // automáticamente, mirando el archivo — vertical o cuadrado (alto ≥ ancho) y 3 minutos
    // o menos. Si se cumple, añadimos #Shorts a la descripción (no es obligatorio, pero
    // ayuda al descubrimiento inicial dentro de la pestaña Shorts); si no se cumple, avisamos
    // para que quede claro que el vídeo subirá como contenido normal, no como Short.
    const qualifiesAsShort = this._qualifiesAsShort(duration);
    let finalDescription = description || '';
    if(qualifiesAsShort && !/#shorts/i.test(finalDescription)){
      finalDescription = finalDescription ? `${finalDescription}\n\n#Shorts` : '#Shorts';
    }
    if(!qualifiesAsShort){
      const reason = this._shortDisqualifyReason(duration);
      UI.toast(`Este vídeo no cumple los requisitos de YouTube Shorts (${reason}) — subirá como vídeo normal, no aparecerá en la pestaña Shorts.`, 'info', 7000);
    }

    const metadata = {
      snippet: { title: (title || 'Storyforge').slice(0,95), description: finalDescription, categoryId: '24' },
      status: { privacyStatus: privacy },
    };

    const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': blob.type || 'video/webm',
        'X-Upload-Content-Length': blob.size,
      },
      body: JSON.stringify(metadata),
    });
    if(!initRes.ok) throw new Error('No se pudo iniciar la subida (HTTP ' + initRes.status + ')');

    const uploadUrl = initRes.headers.get('Location');
    if(!uploadUrl) throw new Error('YouTube no devolvió una URL de subida');

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'video/webm' },
      body: blob,
    });
    if(!uploadRes.ok) throw new Error('Fallo al subir el vídeo (HTTP ' + uploadRes.status + ')');

    return await uploadRes.json();
  },

  // Requisitos reales de YouTube para clasificar automáticamente un vídeo como Short (2026):
  // aspecto vertical o cuadrado (alto ≥ ancho) y 3 minutos (180s) o menos de duración.
  // No hay ningún campo de la API para forzar esta clasificación — YouTube la decide sola
  // mirando el archivo subido.
  _qualifiesAsShort(duration){
    const aspect = AppState.data.advanced.aspect; // '9:16', '1:1', o '16:9'
    const isVerticalOrSquare = aspect === '9:16' || aspect === '1:1';
    return isVerticalOrSquare && duration > 0 && duration <= 180;
  },

  _shortDisqualifyReason(duration){
    const aspect = AppState.data.advanced.aspect;
    const reasons = [];
    if(aspect === '16:9') reasons.push('formato horizontal en vez de vertical o cuadrado');
    if(duration > 180) reasons.push(`dura ${UI.formatTime(duration)}, más de los 3 minutos permitidos`);
    return reasons.join(' y ') || 'no cumple los requisitos';
  }
};
