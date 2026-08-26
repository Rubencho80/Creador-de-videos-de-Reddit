/* ===========================================================
   UI — navegación, toasts, modales
   =========================================================== */

const UI = {

  initTabs(){
    const tabs = document.querySelectorAll('.ttab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected','false'); });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected','true');

        const targetId = tab.dataset.panel;
        document.querySelectorAll('[data-panel-view]').forEach(p => p.hidden = true);
        document.getElementById(targetId).hidden = false;

        // La sub-pestaña de salida IA vive fuera de la barra principal;
        // si estamos en el panel IA, la mostramos también apilada debajo via botón propio.
      });
    });
  },

  showIaOutputTab(){
    document.querySelectorAll('[data-panel-view]').forEach(p => p.hidden = true);
    document.getElementById('panel-ia-output').hidden = false;
    document.querySelectorAll('.ttab').forEach(t => t.classList.remove('is-active'));
  },

  toast(message, type = 'info', duration = 3400){
    const stack = document.getElementById('toast-stack');
    const el = document.createElement('div');
    el.className = `toast ${type === 'ok' ? 'toast-ok' : type === 'err' ? 'toast-err' : ''}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s';
      setTimeout(() => el.remove(), 260);
    }, duration);
  },

  openModal(id){ document.getElementById(id).hidden = false; },
  closeModal(id){ document.getElementById(id).hidden = true; },

  initModalCloses(){
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if(e.target === backdrop) backdrop.hidden = true;
      });
    });
  },

  formatTime(seconds){
    if(!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2,'0')}`;
  },
};
