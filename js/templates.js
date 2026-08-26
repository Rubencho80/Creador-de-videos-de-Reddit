/* ===========================================================
   TEMPLATES — guardar/cargar/exportar/importar
   =========================================================== */

const TemplatesModule = {

  init(){
    this.renderList();
    document.getElementById('btn-template-save').addEventListener('click', () => this.save());
    document.getElementById('btn-export-settings').addEventListener('click', () => this.exportSettings());
    document.getElementById('input-import-settings').addEventListener('change', (e) => this.importSettings(e));
    document.getElementById('btn-export-templates').addEventListener('click', () => this.exportTemplates());
    document.getElementById('input-import-templates').addEventListener('change', (e) => this.importTemplates(e));
  },

  save(){
    const nameInput = document.getElementById('txt-template-name');
    const name = nameInput.value.trim();
    if(!name){
      UI.toast('Ponle un nombre a la plantilla', 'err');
      return;
    }
    Templates.save(name, AppState.data);
    nameInput.value = '';
    this.renderList();
    UI.toast(`Plantilla "${name}" guardada`, 'ok');
  },

  renderList(){
    const container = document.getElementById('template-list');
    const templates = Templates.list();

    if(templates.length === 0){
      container.innerHTML = '<p class="field-hint">Todavía no has guardado ninguna plantilla.</p>';
      return;
    }

    container.innerHTML = '';
    templates.slice().reverse().forEach(tpl => {
      const item = document.createElement('div');
      item.className = 'template-item';
      item.innerHTML = `
        <span class="template-item-name">${escapeHtml(tpl.name)}</span>
        <div class="template-item-actions">
          <button class="btn btn-secondary btn-sm" data-action="load">Cargar</button>
          <button class="btn btn-ghost btn-sm" data-action="delete">Borrar</button>
        </div>
      `;
      item.querySelector('[data-action="load"]').addEventListener('click', () => this.load(tpl.id));
      item.querySelector('[data-action="delete"]').addEventListener('click', () => this.remove(tpl.id));
      container.appendChild(item);
    });
  },

  load(id){
    const tpl = Templates.list().find(t => t.id === id);
    if(!tpl) return;
    AppState.data = deepMerge(defaultState(), tpl.data);
    AppState.commit();
    location.reload(); // recarga simple para reconstruir todos los bindings de inputs limpiamente
  },

  remove(id){
    Templates.remove(id);
    this.renderList();
    UI.toast('Plantilla eliminada', 'ok');
  },

  exportSettings(){
    const blob = new Blob([JSON.stringify(AppState.data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'storyforge-ajustes.json');
    UI.toast('Ajustes exportados', 'ok');
  },

  importSettings(e){
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const parsed = JSON.parse(reader.result);
        AppState.data = deepMerge(defaultState(), parsed);
        AppState.commit();
        UI.toast('Ajustes importados', 'ok');
        location.reload();
      }catch(err){
        UI.toast('El archivo no es un JSON de ajustes válido', 'err');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  },

  exportTemplates(){
    const templates = Templates.list();
    if(templates.length === 0){
      UI.toast('No tienes plantillas que exportar', 'err');
      return;
    }
    const blob = new Blob([JSON.stringify(templates, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'storyforge-plantillas.json');
    UI.toast('Plantillas exportadas', 'ok');
  },

  importTemplates(e){
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const parsed = JSON.parse(reader.result);
        if(!Array.isArray(parsed)) throw new Error('formato incorrecto');
        const current = Templates.list();
        const merged = current.concat(parsed.filter(t => t.id && t.data));
        Templates.setAll(merged);
        this.renderList();
        UI.toast(`${parsed.length} plantilla(s) importada(s)`, 'ok');
      }catch(err){
        UI.toast('El archivo no es un JSON de plantillas válido', 'err');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }
};

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
