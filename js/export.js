/* ===========================================================
   EXPORT — renderiza el vídeo final componiendo canvas + audio
   =========================================================== */

const ExportModule = {

  init(){
    document.getElementById('btn-export').addEventListener('click', () => this.openModal());
    document.getElementById('modal-export-close').addEventListener('click', () => UI.closeModal('modal-export'));
    document.getElementById('btn-export-cancel').addEventListener('click', () => UI.closeModal('modal-export'));
    document.getElementById('btn-export-start').addEventListener('click', () => this.run());
  },

  openModal(){
    document.getElementById('export-progress-wrap').hidden = true;
    document.getElementById('export-result').hidden = true;
    document.getElementById('btn-export-start').hidden = false;
    UI.openModal('modal-export');
  },

  async run(){
    if(!window._bgVideoFile){
      UI.toast('Sube primero un vídeo de fondo', 'err');
      return;
    }
    if(!AppState.data.story.text.trim()){
      UI.toast('Escribe primero la historia a narrar', 'err');
      return;
    }
    if(location.protocol === 'file:'){
      UI.toast('Estás abriendo el archivo directamente (file://) — el audio no se graba de forma fiable así. Sirve la carpeta con un servidor local: abre una terminal ahí y ejecuta "python -m http.server 5500", luego entra a localhost:5500', 'err', 9000);
      return;
    }

    document.getElementById('btn-export-start').hidden = true;
    document.getElementById('export-progress-wrap').hidden = false;

    try{
      const { videoBlob, totalDuration } = await this.produceVideo((pct, label) => this._setProgress(pct, label));

      this._setProgress(95, 'Finalizando archivo...');
      const url = URL.createObjectURL(videoBlob);
      const previewVideo = document.getElementById('export-preview-video');
      previewVideo.src = url;

      document.getElementById('export-final-duration').textContent = UI.formatTime(totalDuration);
      document.getElementById('btn-download-video').href = url;
      const fname = `storyforge-${Date.now()}.webm`;
      document.getElementById('btn-download-video').download = fname;

      this._setProgress(100, 'Listo');
      setTimeout(() => {
        document.getElementById('export-progress-wrap').hidden = true;
        document.getElementById('export-result').hidden = false;
      }, 400);

      window._lastExportedBlob = videoBlob;
      window._lastExportedDuration = totalDuration;

      UI.toast('Vídeo renderizado correctamente', 'ok');
    }catch(err){
      console.error(err);
      document.getElementById('export-progress-wrap').hidden = true;
      document.getElementById('btn-export-start').hidden = false;
      UI.toast('Error al exportar: ' + err.message, 'err');
    }
  },

  // Lógica de negocio pura: genera el audio si falta y renderiza el vídeo final. No toca
  // ningún elemento del modal manual y SIEMPRE relanza cualquier error (nunca lo traga),
  // para que quien la llame — el flujo manual o el modo automático — decida cómo reaccionar.
  // onProgress(pct, label) es opcional; si no se pasa, no se reporta progreso.
  async produceVideo(onProgress){
    const report = onProgress || (() => {});

    report(2, 'Preparando audio de narración...');

    // Pausar el vídeo de fondo del preview mientras se exporta: durante el render se crea un
    // segundo elemento <video> independiente que decodifica el mismo archivo en bucle, y tener
    // dos decodificadores de vídeo activos a la vez en la misma pestaña compite por recursos
    // y ralentiza el renderizado.
    const previewVideo = document.getElementById('preview-bg-video');
    const wasPreviewPlaying = previewVideo && !previewVideo.paused;
    if(previewVideo) previewVideo.pause();

    try{
      // 1. Asegurar que tenemos audio de narración generado
      let audioBlob = VoiceModule.lastAudioBlob;
      let audioDuration = VoiceModule.lastAudioDuration;
      if(!audioBlob){
        audioBlob = await (AppState.data.voice.engine === 'elevenlabs'
          ? VoiceModule.fetchElevenAudio(AppState.data.story.text.trim())
          : VoiceModule.recordBrowserSpeech(AppState.data.story.text.trim()));
        audioDuration = await VoiceModule.measureBlobDuration(audioBlob);
        VoiceModule.lastAudioBlob = audioBlob;
        VoiceModule.lastAudioDuration = audioDuration;
      }

      report(15, 'Calculando duración del vídeo...');

      const leadIn = Number(AppState.data.advanced.leadIn) || 0;
      const leadOut = Number(AppState.data.advanced.leadOut) || 0;
      const totalDuration = leadIn + audioDuration + leadOut;

      // Calidad reducida: mismas proporciones que el formato elegido, pero con menos píxeles
      // totales que procesar en tiempo real.
      let overrideW, overrideH;
      if(AppState.data.advanced.exportQuality === 'reduced'){
        const aspect = AppState.data.advanced.aspect;
        [overrideW, overrideH] = aspect === '1:1' ? [720,720] : aspect === '16:9' ? [1280,720] : [720,1280];
      }

      report(25, 'Renderizando fotogramas...');
      const videoBlob = await this.renderCanvasVideo(totalDuration, leadIn, audioBlob, audioDuration, overrideW, overrideH);

      return { videoBlob, totalDuration };
    }finally{
      if(previewVideo && wasPreviewPlaying) previewVideo.play().catch(()=>{});
    }
  },

  _setProgress(pct, label){
    document.getElementById('export-progress-fill').style.width = pct + '%';
    document.getElementById('export-progress-label').textContent = label;
  },

  /* ---------------------------------------------------------
     Renderiza: crea un <canvas> que dibuja frame a frame el
     vídeo de fondo (en bucle) + tarjeta Reddit, captura ese
     canvas como stream de vídeo, le añade la pista de audio
     (narración, con silencio de leadIn al principio) y lo
     graba todo con MediaRecorder durante exactamente
     totalDuration segundos.
     --------------------------------------------------------- */
  async renderCanvasVideo(totalDuration, leadIn, audioBlob, audioDuration, overrideW, overrideH){
    const aspect = AppState.data.advanced.aspect;
    const dims = overrideW && overrideH
      ? [overrideW, overrideH]
      : aspect === '1:1' ? [1080,1080] : aspect === '16:9' ? [1920,1080] : [1080,1920];
    const [W,H] = dims;

    // --- canvas oculto de trabajo ---
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // --- vídeo de fondo, elemento independiente para no tocar el preview visible ---
    const bgVideo = document.createElement('video');
    const bgVideoUrl = URL.createObjectURL(window._bgVideoFile);
    bgVideo.src = bgVideoUrl;
    bgVideo.muted = true;
    bgVideo.loop = true;
    bgVideo.playsInline = true;
    // Se añade al DOM (oculto) en vez de dejarlo huérfano: un <video> desconectado del árbol
    // puede recibir un tratamiento distinto de sus recursos de decodificación en algunos
    // navegadores.
    bgVideo.style.position = 'fixed';
    bgVideo.style.left = '-9999px';
    bgVideo.style.width = '1px';
    bgVideo.style.height = '1px';
    document.body.appendChild(bgVideo);
    await new Promise((resolve,reject) => {
      bgVideo.onloadeddata = resolve;
      bgVideo.onerror = () => reject(new Error('No se pudo cargar el vídeo de fondo'));
    });
    await bgVideo.play();

    // --- pre-renderizar la tarjeta Reddit a una imagen (para no tener que re-layoutear HTML cada frame) ---
    const cardImg = await this.rasterizeCard(W, H);

    // --- stream de vídeo desde el canvas ---
    // captureStream(30) delega en el navegador el envío de frames a intervalos regulares en
    // tiempo real; si el codificador VP9 no consigue seguir el ritmo bajo carga (resolución
    // alta, vídeo de fondo con mucho movimiento, CPU ocupada), MediaRecorder tira frames en
    // silencio en vez de esperar — el síntoma es un vídeo final con muchos menos fps de los
    // pedidos. captureStream(0) + requestFrame() delega ese control aquí: cada frame se envía
    // explícitamente tras dibujarlo, así el ritmo de captura queda ligado al propio bucle en
    // vez de al reloj en tiempo real del navegador.
    const canvasStream = canvas.captureStream(0);
    const canvasTrack = canvasStream.getVideoTracks()[0];

    // --- pista de audio: silencio (leadIn) + narración real, mediante AudioContext ---
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const destination = audioCtx.createMediaStreamDestination();

    const audioArrayBuffer = await audioBlob.arrayBuffer();
    let decodedBuffer = null;
    try{
      // decodeAudioData puede quedarse colgado sin resolver ni rechazar de forma intermitente
      // tras varias llamadas sucesivas en la misma sesión (observado empíricamente al generar
      // varios vídeos seguidos en el modo automático) — un timeout de seguridad evita que un
      // solo vídeo del lote bloquee el resto de forma indefinida; si salta, se trata igual que
      // un fallo de decodificación y se usa el mismo camino de fallback de más abajo.
      const decodeTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('decodeAudioData no respondió a tiempo')), 8000)
      );
      decodedBuffer = await Promise.race([
        audioCtx.decodeAudioData(audioArrayBuffer.slice(0)),
        decodeTimeout,
      ]);
    }catch(e){
      // Algunos navegadores no decodifican webm/opus vía decodeAudioData, o la llamada se
      // queda colgada; en ambos casos usamos el fallback: reproducir el blob con un <audio>
      // conectado a un MediaElementSource.
      decodedBuffer = null;
    }

    // preparar (pero NO arrancar aún) la fuente de audio, para poder programarla justo antes
    // de recorder.start() y no antes — decodeAudioData es asíncrono y puede tardar bastante,
    // así que calcular el instante de inicio antes de esa espera dejaba un hueco de retraso
    // no contabilizado entre "cuándo arranca la grabación" y "cuándo empieza a sonar la voz".
    let fallbackAudioEl = null;
    let audioSource = null;
    if(decodedBuffer){
      audioSource = audioCtx.createBufferSource();
      audioSource.buffer = decodedBuffer;
      audioSource.connect(destination);
    }else{
      fallbackAudioEl = document.createElement('audio');
      fallbackAudioEl.src = URL.createObjectURL(audioBlob);
      fallbackAudioEl.style.display = 'none';
      document.body.appendChild(fallbackAudioEl);
      const srcNode = audioCtx.createMediaElementSource(fallbackAudioEl);
      srcNode.connect(destination);
      await new Promise(res => {
        if(fallbackAudioEl.readyState >= 2) return res();
        fallbackAudioEl.oncanplay = res;
      });
    }

    // combinar pistas: vídeo del canvas + audio del destino
    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);

    if(combined.getAudioTracks().length === 0){
      audioCtx.close().catch(()=>{});
      if(fallbackAudioEl) fallbackAudioEl.remove();
      throw new Error('No se pudo preparar la pista de audio para grabar. Revisa que no estés en file:// y que el navegador tenga permiso para reproducir audio.');
    }

    const mimeType = this.pickSupportedMime();
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if(e.data.size > 0) chunks.push(e.data); };
    recorder.onerror = (e) => {
      console.error('MediaRecorder error:', e.error || e);
      UI.toast('Error durante la grabación: ' + (e.error ? e.error.message : 'desconocido'), 'err');
    };

    const recordingDone = new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    // IMPORTANTE: pasar un timeslice explícito (ms) a start(). Sin él, algunas versiones de
    // Chromium combinan mal las pistas de canvas.captureStream() + AudioContext y solo entregan
    // un chunk residual casi vacío al parar, en vez de ir emitiendo datos durante toda la grabación
    // — el síntoma es un archivo final de apenas un puñado de bytes, sin vídeo ni audio real.
    recorder.start(250);

    // Arrancar el audio JUSTO AQUÍ, inmediatamente después de que la grabación ya está en
    // marcha — así startAt refleja el instante real de inicio de la grabación, no un momento
    // anterior al trabajo asíncrono de decode/setup. Con leadIn=0 esto hace que la voz suene
    // desde el primer frame grabado, en vez de con el retraso que antes quedaba sin contar.
    const startAt = audioCtx.currentTime + 0.03;
    if(audioSource){
      audioSource.start(startAt + leadIn);
    }else if(fallbackAudioEl){
      if(leadIn > 0){
        setTimeout(() => fallbackAudioEl.play().catch(()=>{}), leadIn * 1000);
      }else{
        fallbackAudioEl.play().catch(()=>{});
      }
    }

    // --- bucle de dibujo ---
    const dimAlpha = (AppState.data.bg.dim || 0) / 100;
    const fit = AppState.data.bg.fit;
    const targetFps = 30;
    const frameIntervalMs = 1000 / targetFps;

    const drawFrame = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0,0,W,H);
      drawCover(ctx, bgVideo, W, H, fit);
      ctx.fillStyle = `rgba(0,0,0,${dimAlpha})`;
      ctx.fillRect(0,0,W,H);
      ctx.drawImage(cardImg, 0, 0, W, H);
      canvasTrack.requestFrame();
    };

    // setInterval en vez de requestAnimationFrame: rAF está limitado a la tasa de refresco de
    // la pantalla del usuario (puede bajar de 60Hz en portátiles con ahorro de energía) y se
    // pausa si la pestaña pierde el foco — ninguno de los dos es deseable durante un render
    // que debe completarse con un ritmo de frames predecible independientemente de la pantalla.
    const frameTimer = setInterval(drawFrame, frameIntervalMs);
    drawFrame(); // primer frame inmediato, sin esperar al primer tick del intervalo

    // progreso visual durante el render
    const progressStart = 25, progressEnd = 90;
    const progressTimer = setInterval(() => {
      // aproximación por tiempo transcurrido, ya que MediaRecorder no da progreso real
    }, 200);

    await new Promise(resolve => setTimeout(resolve, totalDuration * 1000));

    clearInterval(frameTimer);
    clearInterval(progressTimer);
    recorder.stop();
    bgVideo.pause();

    const finalBlob = await recordingDone;
    audioCtx.close().catch(()=>{});
    if(fallbackAudioEl) fallbackAudioEl.remove();
    bgVideo.remove();
    URL.revokeObjectURL(bgVideoUrl);
    // liberar explícitamente la memoria de backing del canvas: poner sus dimensiones a 0
    // es la técnica estándar para forzar esto en navegadores que no lo hacen solos al perder
    // la última referencia, relevante cuando se generan varios vídeos seguidos en el modo
    // automático y cada canvas puede pesar bastante (hasta 1080x1920 sin comprimir).
    canvas.width = 0;
    canvas.height = 0;

    // Comprobación ligera: un .webm grabado correctamente, incluso con vídeo de fondo sencillo
    // y audio en silencio, pesa al menos unos pocos KB por segundo. El caso realmente roto
    // (MediaRecorder sin timeslice combinando mal las pistas) produce apenas un puñado de bytes
    // en total, muy por debajo de cualquier grabación real por sencilla que sea.
    const expectedMinBytes = totalDuration * 2000; // ~2KB/s como suelo mínimo razonable
    if(finalBlob.size < expectedMinBytes){
      console.warn(`Vídeo exportado sospechosamente pequeño: ${finalBlob.size} bytes para ${totalDuration.toFixed(1)}s. Puede faltar audio o vídeo.`);
      UI.toast('El vídeo se ha generado pero pesa menos de lo esperado — revisa que se oiga bien antes de darlo por bueno.', 'info', 6000);
    }

    return finalBlob;
  },

  pickSupportedMime(){
    // VP8 antes que VP9: VP9 comprime mejor pero es sensiblemente más caro de codificar en
    // tiempo real, lo que hace que MediaRecorder descarte muchos más frames del canvas bajo
    // carga (confirmado con medición directa: VP9 grabó ~20% de los frames pedidos a 30fps,
    // VP8 más del doble). Para grabar un canvas en vivo, priorizamos que el vídeo no vaya a
    // trompicones sobre que el archivo pese algo menos.
    const candidates = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    for(const c of candidates){
      if(MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  },

  // Dibuja la tarjeta Reddit (usando el DOM real, para reutilizar el CSS) a una imagen offscreen
  // mediante un clon temporal renderizado con html-to-canvas manual simplificado: dado que no tenemos
  // html2canvas como dependencia, dibujamos la tarjeta directamente en canvas 2D replicando el layout.
  async rasterizeCard(W, H){
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const c = off.getContext('2d');
    const s = AppState.data.card;
    const isLight = s.theme === 'light';

    const cardW = W * (s.width/100);
    const cardX = (W - cardW) / 2;

    const pad = cardW * 0.045;
    c.save();
    c.translate(cardX, 0);

    // medir alto según el título (wrap) antes de dibujar fondo
    const titleFontSize = Math.round(cardW * 0.052);
    c.font = `600 ${titleFontSize}px Inter, sans-serif`;
    const titleLines = wrapText(c, s.title || '', cardW - pad*2);
    const titleLineHeight = titleFontSize * 1.38;
    const headH = cardW * 0.135;
    const footH = cardW * 0.09;
    const cardH = headH + (titleLines.length * titleLineHeight) + footH + pad*1.3;
    const cardY = (H - cardH) / 2 + ((s.offsetY || 0) / 100) * H;

    c.translate(0, cardY);

    // fondo tarjeta
    roundRect(c, 0, 0, cardW, cardH, cardW*0.035);
    c.fillStyle = isLight ? '#ffffff' : '#1a1a1b';
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = isLight ? '#e4e4e4' : '#343536';
    c.stroke();

    let y = pad;

    // avatar
    const avR = cardW * 0.033;
    const avX = pad + avR;
    const avY = y + avR;
    c.save();
    c.beginPath();
    c.arc(avX, avY, avR, 0, Math.PI*2);
    c.clip();
    if(s.avatarDataUrl && this._avatarImgCache){
      c.drawImage(this._avatarImgCache, avX-avR, avY-avR, avR*2, avR*2);
    }else{
      const grad = c.createLinearGradient(avX-avR, avY-avR, avX+avR, avY+avR);
      grad.addColorStop(0, '#ff5c39'); grad.addColorStop(1, '#c23a1f');
      c.fillStyle = grad;
      c.fillRect(avX-avR, avY-avR, avR*2, avR*2);
    }
    c.restore();

    // subreddit + tiempo
    const textX = avX + avR + cardW*0.025;
    c.textBaseline = 'alphabetic';
    c.font = `700 ${cardW*0.032}px Inter, sans-serif`;
    c.fillStyle = isLight ? '#1a1a1b' : '#d7dadc';
    c.fillText(s.subreddit || '', textX, avY - cardW*0.006);
    const subW = c.measureText(s.subreddit || '').width;
    c.font = `500 ${cardW*0.03}px Inter, sans-serif`;
    c.fillStyle = '#818384';
    c.fillText(` · ${s.time || ''}`, textX + subW, avY - cardW*0.006);

    c.font = `500 ${cardW*0.027}px Inter, sans-serif`;
    c.fillStyle = '#818384';
    c.fillText(s.username || '', textX, avY + cardW*0.028);

    y = headH + pad*0.3;

    // título (multilínea)
    c.font = `600 ${titleFontSize}px Inter, sans-serif`;
    c.fillStyle = isLight ? '#1a1a1b' : '#d7dadc';
    titleLines.forEach((line, i) => {
      c.fillText(line, pad, y + titleFontSize + i*titleLineHeight);
    });
    y += titleLines.length * titleLineHeight + pad*0.4;

    // footer: votos, comentarios
    const footFont = cardW*0.028;
    c.font = `600 ${footFont}px Inter, sans-serif`;
    c.fillStyle = isLight ? '#1a1a1b' : '#d7dadc';

    // triángulo de voto
    c.fillStyle = '#ff5c39';
    c.beginPath();
    const triS = footFont*0.55;
    c.moveTo(pad+triS*0.5, y);
    c.lineTo(pad+triS, y+triS);
    c.lineTo(pad, y+triS);
    c.closePath();
    c.fill();

    c.fillStyle = isLight ? '#1a1a1b' : '#d7dadc';
    c.font = `600 ${footFont}px Inter, sans-serif`;
    c.fillText(s.votes || '0', pad+triS+footFont*0.4, y+triS*0.95);
    const votesW = c.measureText(s.votes || '0').width;
    c.fillStyle = '#818384';
    c.font = `500 ${footFont*0.9}px Inter, sans-serif`;
    c.fillText(` · ${s.percent || ''}`, pad+triS+footFont*0.4+votesW, y+triS*0.95);

    c.restore();

    const bitmap = await createImageBitmap(off);
    // liberar la memoria de backing del canvas offscreen: su contenido ya quedó copiado de
    // forma independiente en el ImageBitmap devuelto, así que no hace falta conservarlo vivo
    off.width = 0;
    off.height = 0;
    return bitmap;
  },

  async preloadAvatar(){
    const s = AppState.data.card;
    if(!s.avatarDataUrl){ this._avatarImgCache = null; return; }
    this._avatarImgCache = await loadImage(s.avatarDataUrl);
  }
};

/* ---------- helpers de canvas ---------- */
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth){
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  words.forEach(word => {
    const test = current ? current + ' ' + word : word;
    if(ctx.measureText(test).width > maxWidth && current){
      lines.push(current);
      current = word;
    }else{
      current = test;
    }
  });
  if(current) lines.push(current);
  return lines;
}

function loadImage(src){
  return new Promise((resolve,reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawCover(ctx, video, W, H, fit){
  if(!video.videoWidth) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  const videoRatio = vw/vh, canvasRatio = W/H;
  let sx,sy,sw,sh;

  if(fit === 'contain'){
    let dw,dh;
    if(videoRatio > canvasRatio){ dw = W; dh = W/videoRatio; } else { dh = H; dw = H*videoRatio; }
    const dx = (W-dw)/2, dy = (H-dh)/2;
    ctx.drawImage(video, dx, dy, dw, dh);
    return;
  }

  // cover
  if(videoRatio > canvasRatio){
    sh = vh; sw = vh*canvasRatio; sx = (vw-sw)/2; sy = 0;
  }else{
    sw = vw; sh = vw/canvasRatio; sx = 0; sy = (vh-sh)/2;
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
}
