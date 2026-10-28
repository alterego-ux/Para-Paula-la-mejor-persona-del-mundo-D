import { STORES, openDB, getAll, getOne, putOne, deleteOne, clearStore, putMany, replaceAll, estimateStorage, requestPersistence } from './db.js';
import { uid, nowISO, esc, dateLabel, dayKey, localInputDateTime, dateFromLocalInput, relativeTime, downloadBlob, slug, fmtBytes, icon } from './utils.js';

const safeGetPref = key => { try { return localStorage.getItem(key); } catch { return null; } };
const safeSetPref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Preferences are optional; the app still works without localStorage. */ } };
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const content = $('#appContent');
const modalBackdrop = $('#modalBackdrop');
const modal = $('#modal');
const toastRegion = $('#toastRegion');
const searchOverlay = $('#searchOverlay');
const searchInput = $('#globalSearch');
const searchResults = $('#searchResults');
const APP_LABEL = 'Entre Líneas';

let dbData = { notes:[], folders:[], tags:[], diary:[], tasks:[], events:[], collections:[], versions:[], metadata:[] };
let currentView = 'inicio';
let currentNoteId = null;
let currentEditorType = 'note';
let editorGeneration = 0;
let editorSavedGeneration = 0;
let editorTimer = null;
let saveChain = Promise.resolve();
let editorStatus = 'saved';
let lastSavedContent = '';
let lastVersionAt = 0;
let activeSettingsTab = 'general';
let calendarCursor = new Date();
let searchActiveIndex = -1;
let pendingImport = null;
let reminderTimer = null;
let toastCounter = 0;
let lastFocusedBeforeModal = null;
let lastStorageEstimate = null;
let editorDirty = false;
let editorHistory = [];
let editorHistoryIndex = -1;
let editorSessionId = 0;
let editorReturnView = 'notas';

const viewLabels = { inicio:'Inicio', inbox:'Bandeja de entrada', notas:'Todas las notas', borradores:'Borradores', diario:'Diario personal', favoritos:'Favoritos', tareas:'Tareas', calendario:'Calendario', colecciones:'Colecciones', archivados:'Archivados', papelera:'Papelera', configuracion:'Configuración', editor:'Nota' };
const defaultMeta = { id:'app-meta', name:'Entre Líneas', description:'Un espacio para guardar todo lo que pasa por tu mente.', greeting:'Este espacio es tuyo, Paula. Aquí hay lugar para todas tus ideas, incluso las que todavía no sabes cómo ordenar.', profileName:'Paula', lastBackupAt:null };
const getMeta = () => ({ ...defaultMeta, ...(dbData.metadata.find(x=>x.id==='app-meta') || {}) });
const PREF_VIEWS = new Set(['inicio','inbox','notas','borradores','diario','favoritos','tareas','calendario','colecciones','archivados','papelera','configuracion']);
const activeNotes = () => dbData.notes.filter(n=>!n.deletedAt && !n.archivedAt);
const byUpdated = (a,b) => new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0);

function updateIconElements(root=document) {
  $$('[data-icon]', root).forEach(el => { const name=el.getAttribute('data-icon'); el.innerHTML=icon(name, el.dataset.size ? Number(el.dataset.size) : 17); });
}
function toast(message, kind='success') {
  const node=document.createElement('div'); node.className=`toast ${kind==='error'?'error':kind==='warning'?'warning':''}`;
  node.innerHTML=`${icon(kind==='error'?'circle-alert':kind==='warning'?'circle-alert':'check',17)}<span>${esc(message)}</span>`;
  toastRegion.append(node); setTimeout(()=>node.remove(), 4400);
}
function setStorageStatus(text, kind='') {
  const el=$('#storageStatus'); if(el) { el.textContent=text; el.className=`footer-storage ${kind}`; }
}
function setEditorStatus(status, detail='') {
  editorStatus=status;
  const el=$('#saveStatus'); if(!el) return;
  const label={writing:'Escribiendo…',saving:'Guardando…',saved:'Guardado',error:'Error al guardar'}[status] || status;
  el.className=`save-status ${status==='saved'?'saved':status==='error'?'error':''}`;
  el.innerHTML=`<span class="pip"></span><span>${label}${detail?` · ${esc(detail)}`:''}</span>`;
}
async function loadAll() {
  const entries = await Promise.all(STORES.map(s=>getAll(s)));
  dbData = Object.fromEntries(STORES.map((s,i)=>[s,entries[i]]));
  if (!dbData.metadata.some(x=>x.id==='app-meta')) { await putOne('metadata', defaultMeta); dbData.metadata.push(defaultMeta); }
  renderSidebar();
}
function renderSidebar() {
  const meta=getMeta();
  $('#brandName').textContent=meta.name || APP_LABEL;
  $('.mobile-brand-name').textContent=meta.name || APP_LABEL;
  $('#profileName').textContent=meta.profileName || 'Paula';
  $('.avatar').textContent=(meta.profileName || 'P').trim().charAt(0).toUpperCase() || 'P';
  const inboxCount=dbData.notes.filter(n=>n.inbox && !n.deletedAt && !n.archivedAt).length;
  $('#inboxCount').textContent=inboxCount ? String(inboxCount) : '';
  const folderNav=$('#folderNav');
  const sorted=[...dbData.folders].sort((a,b)=>(a.order||0)-(b.order||0)||a.name.localeCompare(b.name,'es'));
  folderNav.innerHTML=sorted.map(folder=>`<button class="nav-item" data-folder="${esc(folder.id)}"><span class="folder-dot"></span><span>${esc(folder.name)}</span></button>`).join('');
  $$('.nav-item[data-view]').forEach(btn=>btn.classList.toggle('active', btn.dataset.view===currentView));
  $$('.nav-item[data-folder]').forEach(btn=>btn.classList.toggle('active', currentView==='folder' && btn.dataset.folder===activeFolderId));
  updateIconElements(folderNav);
}
let activeFolderId=null;
function render() {
  if(currentView!=='editor'&&PREF_VIEWS.has(currentView))safeSetPref('entre-lineas-last-view',currentView);
  renderSidebar();
  const meta=getMeta();
  if(currentView==='editor') return renderEditor();
  $('#breadcrumbs').innerHTML=`<span>Tu espacio</span><span class="crumb-sep">/</span><strong>${esc(currentView==='folder'?(dbData.folders.find(f=>f.id===activeFolderId)?.name||'Carpeta'):viewLabels[currentView]||currentView)}</strong>`;
  const renderers={inicio:renderHome,inbox:()=>renderNoteList('inbox'),notas:()=>renderNoteList('notas'),borradores:()=>renderNoteList('borradores'),diario:renderDiary,favoritos:()=>renderNoteList('favoritos'),tareas:renderTasks,calendario:renderCalendar,colecciones:renderCollections,archivados:()=>renderNoteList('archivados'),papelera:()=>renderNoteList('papelera'),configuracion:renderSettings,folder:()=>renderNoteList('folder')};
  (renderers[currentView]||renderHome)();
  updateIconElements(content);
}
function pageHeader(eyebrow,title,subtitle,actions='') {
 return `<div class="page-header"><div><div class="eyebrow">${esc(eyebrow)}</div><h1 class="page-title">${title}</h1>${subtitle?`<p class="page-subtitle">${subtitle}</p>`:''}</div><div class="header-actions">${actions}</div></div>`;
}
function emptyState(title,desc,buttonText='',action='') {
 return `<div class="empty-state"><div class="empty-symbol">${icon('notebook-pen',23)}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p>${buttonText?`<button class="button" data-action="${esc(action)}">${icon('plus',15)}${esc(buttonText)}</button>`:''}</div>`;
}
function shortPreview(contentValue, limit=170) { const txt=String(contentValue||'').replace(/^#+\s/gm,'').replace(/[>*_`~-]/g,'').trim(); return txt.length>limit?txt.slice(0,limit)+'…':txt; }
function tagsMarkup(tags=[]) { return (tags||[]).slice(0,3).map(t=>`<span class="meta-tag">${esc(t)}</span>`).join(''); }
function noteRow(note, type='note') {
 const kind=type==='capture'?'capture':type==='diary'?'diary':'';
 return `<article class="note-row" tabindex="0" role="button" data-open-item="${esc(note.id)}" data-item-type="${type}"><div class="note-icon ${kind}">${icon(type==='diary'?'book-open':type==='capture'?'inbox':'file-text',17)}</div><div class="note-main"><h3 class="note-name">${esc(note.title||'Sin título')}</h3><div class="note-preview">${esc(shortPreview(note.content,150)||'Todavía no hay texto. Haz clic para empezar a escribir.')}</div><div class="note-meta"><span>${relativeTime(note.updatedAt||note.createdAt)}</span>${tagsMarkup(note.tags)}${note.folderId?`<span>${esc(dbData.folders.find(f=>f.id===note.folderId)?.name||'')}</span>`:''}</div></div><div class="note-actions"><button class="tiny-icon" aria-label="Abrir nota">${icon('chevron-right',15)}</button></div></article>`;
}
function listNote(note,type='note') {
 return `<article class="list-note" tabindex="0" role="button" data-open-item="${esc(note.id)}" data-item-type="${type}"><div class="note-icon ${type==='capture'?'capture':type==='diary'?'diary':''}">${icon(type==='capture'?'inbox':type==='diary'?'book-open':'file-text',16)}</div><div class="list-note-copy"><h3 class="list-note-title">${esc(note.title||'Sin título')}</h3><div class="list-note-preview">${esc(shortPreview(note.content,230)||'Sin contenido todavía')}</div><div class="note-meta">${tagsMarkup(note.tags)}${note.folderId?`<span class="meta-tag">${esc(dbData.folders.find(f=>f.id===note.folderId)?.name||'Carpeta')}</span>`:''}${note.inbox?'<span class="pill amber">Sin organizar</span>':''}</div></div><div class="list-note-date">${relativeTime(note.updatedAt||note.createdAt)}</div></article>`;
}
function renderHome() {
 const meta=getMeta();
 const all=activeNotes().filter(n=>!n.inbox && n.type!=='capture');
 const recent=[...all].sort(byUpdated).slice(0,5);
 const captures=dbData.notes.filter(n=>n.inbox&&!n.deletedAt&&!n.archivedAt).sort(byUpdated).slice(0,3);
 const tasks=dbData.tasks.filter(t=>!t.done).sort((a,b)=>String(a.dueAt||'9999').localeCompare(String(b.dueAt||'9999'))).slice(0,4);
 const upcoming=dbData.events.filter(e=>!e.deletedAt && new Date(e.startAt)>=new Date(Date.now()-3600000)).sort((a,b)=>new Date(a.startAt)-new Date(b.startAt)).slice(0,3);
 content.innerHTML=`<section class="welcome-panel"><div class="welcome-copy"><div class="welcome-kicker">Tu rincón personal</div><h1 class="welcome-title">Un lugar para todo lo que <em>pasa por tu mente.</em></h1><p>${esc(meta.greeting||'Un espacio para tus ideas, sin prisa y a tu manera.')}</p><div class="welcome-actions"><button class="button" data-action="new-note">${icon('plus',15)} Escribir una nota</button><button class="button-secondary" data-action="quick-capture">${icon('inbox',15)} Guardar una idea</button></div></div><div class="welcome-orbit" aria-hidden="true"><span class="orbit-spark one">✳</span><div class="orbit-ring"><div class="orbit-paper"><i></i><i></i><i></i><i></i></div></div><span class="orbit-spark two">✧</span></div></section>
 <div class="home-grid"><section class="home-left"><div class="section-heading"><h2 class="section-title">Volver a tus palabras</h2><button class="section-link" data-action="view-notas">Ver todas ${icon('chevron-right',12)}</button></div>${recent.length?recent.map(n=>noteRow(n)).join(''):emptyState('Tu primera página empieza aquí','Crea una nota para guardar una idea, un texto o algo que quieras recordar.','Crear una nota','new-note')}
 ${captures.length?`<div style="margin-top:29px"><div class="section-heading"><h2 class="section-title">Por organizar</h2><button class="section-link" data-action="view-inbox">Ver bandeja ${icon('chevron-right',12)}</button></div>${captures.map(n=>noteRow(n,'capture')).join('')}</div>`:''}</section>
 <aside class="home-right"><section class="mini-panel"><div class="mini-panel-head"><h3>Lo que sigue</h3><button class="section-link" data-action="view-tareas">Ver tareas</button></div>${tasks.length?tasks.map(t=>`<label class="task-mini"><input type="checkbox" data-toggle-task="${esc(t.id)}"><span>${esc(t.title)}${t.dueAt?`<small class="${t.dueAt<dayKey(new Date())?'overdue':''}">${t.dueAt<dayKey(new Date())?'Vencida · ':''}${esc(dateLabel(`${t.dueAt}T12:00:00-05:00`))}</small>`:''}</span></label>`).join(''):'<div class="muted-small">No hay tareas pendientes. Deja espacio para lo inesperado.</div>'}<button class="button-quiet button-small" data-action="new-task">${icon('plus',13)} Añadir tarea</button></section>
 <section class="mini-panel"><div class="mini-panel-head"><h3>En el calendario</h3><button class="section-link" data-action="view-calendario">Abrir agenda</button></div>${upcoming.length?upcoming.map(e=>{const d=new Date(e.startAt);return `<div class="event-mini"><div class="event-date"><strong>${new Intl.DateTimeFormat('es-CO',{day:'2-digit',timeZone:'America/Bogota'}).format(d)}</strong><span>${new Intl.DateTimeFormat('es-CO',{month:'short',timeZone:'America/Bogota'}).format(d).replace('.','')}</span></div><div class="event-mini-copy"><strong>${esc(e.title)}</strong><span>${dateLabel(e.startAt,{time:true})}</span></div></div>`}).join(''):'<div class="muted-small">No hay eventos próximos por ahora.</div>'}<button class="button-quiet button-small" data-action="new-event">${icon('plus',13)} Crear evento</button></section>
 <section class="mini-panel"><div class="mini-panel-head"><h3>Tu diario</h3><span class="muted-small">${dbData.diary.length} entradas</span></div><p class="muted-small" style="line-height:1.7;margin:0 0 10px">Un sitio para escribir sin tener que ordenar nada primero.</p><button class="button-secondary button-small" data-action="new-diary">${icon('book-open',13)} Escribir en el diario</button></section></aside></div>`;
}
function noteListSource(view) {
 const notes=dbData.notes.filter(n=>{
  if(view==='papelera') return Boolean(n.deletedAt);
  if(n.deletedAt) return false;
  if(view==='archivados') return Boolean(n.archivedAt);
  if(n.archivedAt) return false;
  if(view==='inbox') return Boolean(n.inbox);
  if(view==='borradores') return n.state==='draft'||n.type==='draft';
  if(view==='favoritos') return Boolean(n.favorite);
  if(view==='folder') return n.folderId===activeFolderId;
  return !n.inbox;
 }).sort(byUpdated);
 return notes;
}
function renderNoteList(view) {
 const configs={notas:['ARCHIVO PERSONAL','Todas las notas','Cada texto que guardas tiene un lugar.'],inbox:['CAPTURAS RÁPIDAS','Bandeja de entrada','Guarda primero. Decide dónde va después.'],borradores:['EN PROCESO','Borradores','Textos que todavía están encontrando su forma.'],favoritos:['PARA VOLVER','Favoritos','Tus páginas señaladas para encontrar fácilmente.'],archivados:['FUERA DE VISTA','Archivados','Notas que quieres conservar sin tenerlas en primer plano.'],papelera:['RECUPERACIÓN','Papelera','Los elementos eliminados permanecen aquí hasta que decidas borrarlos definitivamente.'],folder:['CARPETA','Carpeta','Los textos que has reunido en este lugar.']};
 const [eyebrow,title,subtitle]=configs[view]||configs.notas;
 const actualTitle=view==='folder'?(dbData.folders.find(f=>f.id===activeFolderId)?.name||'Carpeta'):title;
 let notes=noteListSource(view);
 const actions=view==='papelera'?'<button class="button-danger" data-action="empty-trash">'+icon('trash-2',15)+' Vaciar papelera</button>':view==='inbox'?`<button class="button-secondary" data-action="import-texts">${icon('upload',15)} Importar .txt / .md</button><input type="file" id="textImportFiles" accept=".txt,.md,text/plain,text/markdown" multiple hidden><button class="button" data-action="quick-capture">${icon('plus',15)} Captura rápida</button>`:`<button class="button" data-action="new-note">${icon('plus',15)} Nueva nota</button>`;
 content.innerHTML=pageHeader(eyebrow,esc(actualTitle),subtitle,actions)+`<div class="list-toolbar"><label class="list-filter">${icon('search',14)}<input id="listSearch" type="search" placeholder="Filtrar estas notas…" aria-label="Filtrar notas"></label><label class="list-filter">${icon('folder',14)}<select id="listFolderFilter" aria-label="Filtrar por carpeta"><option value="">Todas las carpetas</option>${dbData.folders.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></label><div class="list-summary" id="listSummary">${notes.length} ${notes.length===1?'elemento':'elementos'}</div></div><div class="note-grid-list" id="noteList">${notes.length?notes.map(n=>listNote(n,n.type==='capture'?'capture':'note')).join(''):emptyState(view==='inbox'?'Tu bandeja está vacía':view==='papelera'?'La papelera está vacía':'Aquí empieza tu archivo',view==='inbox'?'Pega un mensaje o guarda una idea al vuelo.':view==='papelera'?'No hay nada pendiente de recuperar.':'Todavía no hay elementos en esta sección.',view==='papelera'?'':'Crear una nota',view==='papelera'?'':'new-note')}</div>`;
 const filter=()=>{const q=$('#listSearch')?.value.trim().toLocaleLowerCase('es')||'';const folder=$('#listFolderFilter')?.value||'';const filtered=notes.filter(n=>(!q||`${n.title||''} ${n.content||''} ${(n.tags||[]).join(' ')}`.toLocaleLowerCase('es').includes(q))&&(!folder||n.folderId===folder));$('#noteList').innerHTML=filtered.length?filtered.map(n=>listNote(n,n.type==='capture'?'capture':'note')).join(''):emptyState('No encontramos coincidencias','Prueba con otras palabras o cambia los filtros.');$('#listSummary').textContent=`${filtered.length} ${filtered.length===1?'elemento':'elementos'}`;};
 $('#listSearch').addEventListener('input',filter);$('#listFolderFilter').addEventListener('change',filter);
 const textInput=$('#textImportFiles');textInput?.addEventListener('change',async ev=>{const files=[...(ev.target.files||[])];ev.target.value='';if(!files.length)return;if(files.length>30){toast('Importa hasta 30 archivos de texto a la vez.','warning');return;}let created=0;for(const file of files){if(file.size>10*1024*1024){toast(`Se omitió «${file.name}»: supera 10 MB.`,'warning');continue;}try{const text=await file.text();await createNote({type:'capture',title:file.name.replace(/\.(txt|md)$/i,''),content:text,inbox:true});created++;}catch{toast(`No se pudo importar «${file.name}».`,'error');}}currentView='inbox';render();toast(`${created} archivo(s) guardado(s) en la bandeja.`);});
}
function renderDiary() {
 const entries=[...dbData.diary].sort((a,b)=>String(b.entryDate||b.createdAt).localeCompare(String(a.entryDate||a.createdAt)));
 const grouped=new Map();
 for(const e of entries){const key=e.entryDate||dayKey(e.createdAt); if(!grouped.has(key))grouped.set(key,[]); grouped.get(key).push(e);}
 const body=entries.length?[...grouped.entries()].map(([date,list])=>`<section class="diary-day"><div class="eyebrow">${esc(new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'America/Bogota'}).format(new Date(`${date}T12:00:00-05:00`)))}</div>${list.map(e=>listNote(e,'diary')).join('')}</section>`).join(''):emptyState('Una página en blanco, solo para ti','El diario no necesita preguntas ni una estructura fija. Escribe lo que quieras guardar.','Escribir hoy','new-diary');
 content.innerHTML=pageHeader('ESCRITURA LIBRE','Diario personal','Un registro sin reglas, organizado por fechas.',`<button class="button" data-action="new-diary">${icon('plus',15)} Nueva entrada</button>`)+body;
}
function renderTasks() {
 const pending=dbData.tasks.filter(t=>!t.done).sort((a,b)=>String(a.dueAt||'9999').localeCompare(String(b.dueAt||'9999')));
 const done=dbData.tasks.filter(t=>t.done).sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt));
 const taskHtml=(t)=>`<div class="task-item ${t.done?'done':''}"><input class="task-check" type="checkbox" data-toggle-task="${esc(t.id)}" ${t.done?'checked':''} aria-label="${t.done?'Reabrir':'Completar'} tarea ${esc(t.title)}"><div class="task-item-copy"><div class="task-item-title">${esc(t.title)}</div>${t.description?`<div class="task-item-description">${esc(t.description)}</div>`:''}<div class="task-item-meta">${t.dueAt?`<span>${icon('calendar-days',11)} ${esc(dateLabel(`${t.dueAt}T12:00:00-05:00`,{year:false}))}</span>`:''}${t.priority?`<span class="pill ${t.priority==='Alta'?'red':t.priority==='Media'?'amber':''}">${esc(t.priority)}</span>`:''}</div></div><div class="task-row-actions"><button class="tiny-icon" data-edit-task="${esc(t.id)}" title="Editar tarea">${icon('file-pen-line',14)}</button><button class="tiny-icon" data-delete-task="${esc(t.id)}" title="Eliminar tarea">${icon('trash-2',14)}</button></div></div>`;
 content.innerHTML=pageHeader('PEQUEÑOS PASOS','Tareas','Una lista clara para que las cosas que quieres hacer no se queden entre líneas.',`<button class="button" data-action="new-task">${icon('plus',15)} Nueva tarea</button>`)+`<div class="task-board"><section class="task-column"><div class="task-column-head"><h3>Por hacer</h3><span>${pending.length}</span></div>${pending.length?pending.map(taskHtml).join(''):emptyState('Todo al día','No hay tareas pendientes ahora.','Añadir una tarea','new-task')}</section><section class="task-column"><div class="task-column-head"><h3>Completadas</h3><span>${done.length}</span></div>${done.length?done.map(taskHtml).join(''):'<p class="muted-small">Las tareas que completes aparecerán aquí.</p>'}</section></div>`;
}
function monthName(date) { return new Intl.DateTimeFormat('es-CO',{month:'long',year:'numeric',timeZone:'America/Bogota'}).format(date); }
function renderCalendar() {
 const year=calendarCursor.getFullYear(), month=calendarCursor.getMonth();
 const first=new Date(year,month,1); const start=(first.getDay()+6)%7; // monday-first
 const gridStart=new Date(year,month,1-start);
 const events=dbData.events.filter(e=>!e.deletedAt);
 const weekdays=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
 let cells='';
 for(let i=0;i<42;i++){
  const day=new Date(gridStart);day.setDate(gridStart.getDate()+i);
  const key=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
  const matches=events.filter(e=>dayKey(e.startAt)===key).sort((a,b)=>new Date(a.startAt)-new Date(b.startAt));
  const today=key===dayKey(new Date());
  cells+=`<div class="calendar-cell ${day.getMonth()!==month?'outside':''} ${today?'today':''}" data-calendar-date="${key}" tabindex="0" role="button" aria-label="${esc(dateLabel(`${key}T12:00:00-05:00`,{year:true}))}"><div class="day-number">${day.getDate()}</div>${matches.slice(0,3).map(e=>`<button class="calendar-event" data-open-event="${esc(e.id)}" title="${esc(e.title)}">${esc(e.title)}</button>`).join('')}${matches.length>3?`<div class="calendar-more">+${matches.length-3} más</div>`:''}</div>`;
 }
 content.innerHTML=pageHeader('TU TIEMPO','Calendario','Eventos y recordatorios guardados en este dispositivo.',`<button class="button" data-action="new-event">${icon('plus',15)} Nuevo evento</button>`)+`<div class="calendar-toolbar"><div style="display:flex;align-items:center;gap:10px"><h2 class="calendar-month">${esc(monthName(new Date(year,month,1)))}</h2><button class="button-secondary button-small" data-calendar-today>Hoy</button></div><div class="calendar-nav"><button class="icon-btn" data-calendar-shift="-1" aria-label="Mes anterior">${icon('chevron-left',16)}</button><button class="icon-btn" data-calendar-shift="1" aria-label="Mes siguiente">${icon('chevron-right',16)}</button></div></div><div class="calendar-grid">${weekdays.map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}${cells}</div><p class="calendar-legend">Selecciona un día para crear un evento. Las notificaciones solo se comprueban mientras la aplicación está abierta.</p><section style="margin-top:27px"><div class="section-heading"><h2 class="section-title">Próximos eventos</h2><span class="muted-small">Zona horaria: America/Bogota</span></div>${events.filter(e=>new Date(e.startAt)>=new Date(Date.now()-86400000)).sort((a,b)=>new Date(a.startAt)-new Date(b.startAt)).slice(0,6).map(e=>`<div class="event-mini" style="border-bottom:1px solid var(--line)"><div class="event-date"><strong>${new Intl.DateTimeFormat('es-CO',{day:'2-digit',timeZone:'America/Bogota'}).format(new Date(e.startAt))}</strong><span>${new Intl.DateTimeFormat('es-CO',{month:'short',timeZone:'America/Bogota'}).format(new Date(e.startAt)).replace('.','')}</span></div><div class="event-mini-copy"><strong>${esc(e.title)}</strong><span>${dateLabel(e.startAt,{time:true})}${e.endAt?` – ${dateLabel(e.endAt,{time:true})}`:''}</span>${e.description?`<p class="muted-small">${esc(e.description)}</p>`:''}</div><button class="button-secondary button-small" data-open-event="${esc(e.id)}">Ver</button></div>`).join('')||'<div class="muted-small">Todavía no hay eventos próximos.</div>'}</section>`;
}
function renderCollections() {
 const collections=dbData.collections;
 content.innerHTML=pageHeader('ORGANIZA A TU MANERA','Colecciones','Listas sencillas para reunir ideas, lecturas, proyectos o cualquier tema que quieras seguir.',`<button class="button" data-action="new-collection">${icon('plus',15)} Nueva colección</button>`)+ (collections.length?`<div class="collection-list">${collections.map(c=>`<button class="collection-card" data-open-collection="${esc(c.id)}"><span class="collection-symbol">${icon('table-2',18)}</span><span><h3>${esc(c.name)}</h3><p>${esc(c.description||'Una colección personal.')}</p><span class="collection-count">${(c.items||[]).length} ${(c.items||[]).length===1?'elemento':'elementos'}</span></span></button>`).join('')}</div>`:emptyState('Crea tu primera colección','Empieza con una lista de ideas, libros por leer o proyectos personales. Tú decides qué columnas necesitas.','Crear colección','new-collection'));
}
function renderCollectionDetail(id) {
 const c=dbData.collections.find(x=>x.id===id); if(!c){renderCollections();return;}
 const items=c.items||[];
 content.innerHTML=pageHeader('COLECCIÓN',esc(c.name),esc(c.description||'Una lista que puedes modificar a tu manera.'),`<button class="button-secondary" data-action="collection-rename" data-id="${esc(c.id)}">${icon('file-pen-line',14)} Editar</button><button class="button" data-action="collection-add-item" data-id="${esc(c.id)}">${icon('plus',14)} Añadir elemento</button><button class="button-quiet" data-action="view-colecciones">Volver</button>`)+`<div class="collection-table-wrap"><table class="collection-table"><thead><tr><th>Elemento</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>${items.map(i=>`<tr><td>${esc(i.title||'Sin título')}</td><td>${esc(i.status||'Pendiente')}</td><td>${esc(i.date||'—')}</td><td><button class="tiny-icon" data-delete-collection-item="${esc(i.id)}" data-collection-id="${esc(c.id)}" aria-label="Eliminar elemento">${icon('trash-2',14)}</button></td></tr>`).join('')||`<tr><td colspan="4" class="muted-small">Todavía no hay elementos. Añade el primero cuando quieras.</td></tr>`}</tbody></table></div>`;
}
function renderSettings() {
 const meta=getMeta();
 const estimate=lastStorageEstimate;
 const used=estimate?.usage||0, quota=estimate?.quota||0, percent=quota?Math.min(100,used/quota*100):0;
 const last=meta.lastBackupAt?dateLabel(meta.lastBackupAt,{year:true,time:true}):'Todavía no has creado una copia desde esta aplicación.';
 const panels={general:`<section class="settings-section"><h2>Identidad</h2><p>Haz que el espacio se sienta tuyo. Estos datos solo cambian cómo se muestra la aplicación.</p><form id="identityForm"><div class="form-row"><label for="appName">Nombre del espacio</label><div><input class="form-control" id="appName" maxlength="50" value="${esc(meta.name)}" required><div class="form-help">Por defecto: Entre Líneas.</div></div></div><div class="form-row"><label for="profileNameInput">Nombre visible</label><div><input class="form-control" id="profileNameInput" maxlength="50" value="${esc(meta.profileName)}" required></div></div><div class="form-row"><label for="greetingInput">Mensaje de bienvenida</label><div><textarea class="form-control" id="greetingInput" rows="3" maxlength="500">${esc(meta.greeting)}</textarea></div></div><div class="form-row"><label for="descriptionInput">Descripción</label><div><input class="form-control" id="descriptionInput" maxlength="180" value="${esc(meta.description)}"></div></div><div style="display:flex;justify-content:flex-end"><button class="button" type="submit">Guardar cambios</button></div></form></section><section class="settings-section"><h2>Apariencia</h2><p>Elige cómo se ve Entre Líneas en este dispositivo.</p><div class="toggle-row"><div><strong>Tema oscuro</strong><span>Usa colores borgoña y grafito para escribir en ambientes con poca luz.</span></div><label class="switch"><input id="darkThemeCheck" type="checkbox" ${safeGetPref('entre-lineas-theme')==='dark'?'checked':''}><i></i></label></div><div class="toggle-row"><div><strong>Barra lateral compacta</strong><span>Deja más espacio horizontal para la escritura en pantallas grandes.</span></div><label class="switch"><input id="compactSidebarCheck" type="checkbox" ${safeGetPref('entre-lineas-sidebar')==='collapsed'?'checked':''}><i></i></label></div></section><section class="settings-section"><h2>Almacenamiento</h2><p>Las notas, las tareas y el calendario se guardan en IndexedDB dentro de este navegador.</p><div class="privacy-note">${icon('shield-check',15)} No hay cuenta ni sincronización en la nube. Si borras los datos del sitio, usas otro navegador o cambias de dispositivo, necesitas una copia de seguridad para trasladar tus textos.</div><div class="toggle-row"><div><strong>Espacio estimado del sitio</strong><span>${estimate?`${fmtBytes(used)} utilizados de ${fmtBytes(quota)} disponibles para el origen.`:'El navegador no ha proporcionado una estimación de almacenamiento.'}<div class="storage-meter"><span style="width:${percent}%"></span></div></span></div><button class="button-secondary button-small" id="refreshStorageBtn">Actualizar</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="button-secondary" id="persistStorageBtn">Solicitar almacenamiento persistente</button><button class="button-secondary" id="notificationPermissionBtn">Activar notificaciones</button></div><div class="form-help" id="persistResult"></div></section>`,
 backups:`<section class="settings-section"><h2>Copias de seguridad</h2><p>Exporta tu espacio completo y guarda el archivo en un lugar seguro fuera de este navegador. La copia descargada es responsabilidad tuya.</p><div class="backup-grid"><div class="backup-card"><div class="backup-icon">${icon('download',18)}</div><h3>Exportar todo</h3><p>Notas, borradores, diario, carpetas, etiquetas, tareas, eventos, colecciones y versiones.</p><button class="button wide" id="exportBackupBtn">Exportar JSON</button></div><div class="backup-card"><div class="backup-icon">${icon('lock',18)}</div><h3>Copia cifrada</h3><p>Cifra el archivo de respaldo con una contraseña usando Web Crypto. La contraseña no se guarda.</p><button class="button-secondary wide" id="exportEncryptedBtn">Exportar cifrada</button></div><div class="backup-card"><div class="backup-icon">${icon('upload',18)}</div><h3>Restaurar una copia</h3><p>Valida el archivo antes de importar. Puedes combinar datos sin sobrescribir o reemplazar tras descargar un respaldo actual.</p><button class="button-secondary wide" id="importBackupBtn">Seleccionar archivo</button><input id="backupFileInput" type="file" accept=".json,application/json" hidden></div><div class="backup-card"><div class="backup-icon">${icon('file-text',18)}</div><h3>Exportar una nota</h3><p>Desde el editor, descarga cualquier texto como Markdown o texto plano sin depender de la aplicación.</p><button class="button-secondary wide" data-action="view-notas">Abrir mis notas</button></div></div><div class="callout">${icon('clock',16)}<div><strong>Última exportación solicitada desde la aplicación:</strong><br>${esc(last)}<br>Esto registra las exportaciones iniciadas aquí. No significa que exista una copia en la nube ni que el archivo siga en tu dispositivo.</div></div><div class="callout warning">${icon('circle-alert',16)}<div>Al reemplazar datos, primero se descargará una copia del estado actual. No cierres la pestaña hasta que termine la restauración. Conserva la copia descargada en un lugar seguro.</div></div></section>`,
 privacy:`<section class="settings-section"><h2>Privacidad y límites</h2><p>Entre Líneas funciona en tu navegador. La versión estática no crea cuentas ni envía tus textos a un servidor de la aplicación.</p><div class="privacy-note">${icon('shield-check',15)} Los datos almacenados en IndexedDB no están cifrados automáticamente por esta aplicación. Una persona con acceso a tu perfil del navegador o al dispositivo podría acceder a ellos. El cifrado opcional de copias protege el archivo exportado, no la base local.</div><div class="toggle-row"><div><strong>Permisos de notificación</strong><span id="notificationStatus">Estado del navegador: ${esc('Notification' in window?Notification.permission:'no compatible')}.</span></div><button class="button-secondary button-small" id="notificationPermissionBtn">Configurar</button></div><div class="toggle-row"><div><strong>Recordatorios</strong><span>Solo se comprueban mientras Entre Líneas está abierta. GitHub Pages no ejecuta tareas de servidor ni puede garantizar alarmas con la página cerrada o el equipo apagado.</span></div><span class="pill amber">Solo en esta pestaña</span></div><div class="toggle-row"><div><strong>Datos del espacio</strong><span>La base IndexedDB usa un nombre asociado al primer segmento de ruta del proyecto para evitar colisiones accidentales entre proyectos. Aun así, la seguridad del navegador se basa en el origen (protocolo, dominio y puerto), no en la ruta: otros sitios servidos bajo el mismo origen no deben tratarse como una frontera de seguridad.</span></div><span class="pill">Local-first</span></div></section><section class="settings-section"><h2>Acciones cuidadosas</h2><p>Antes de borrar algo de forma definitiva, crea una copia de seguridad completa.</p><button class="button-danger" id="clearAllDataBtn">Eliminar todos los datos locales…</button></section>`,
 shortcuts:`<section class="settings-section"><h2>Atajos de teclado</h2><p>Atajos pensados para capturar ideas sin interrumpir demasiado la escritura.</p>${[['Nueva nota','N'],['Capturar una idea','Q'],['Buscar en todo','Ctrl / ⌘ + K'],['Cerrar diálogo','Esc']].map(([label,key])=>`<div class="shortcut-help"><span>${label}</span><span><kbd>${esc(key)}</kbd></span></div>`).join('')}<div class="callout">${icon('circle-alert',16)}<div>Los atajos de letras funcionan cuando no estás escribiendo dentro de un campo de texto. En algunos navegadores, los atajos del sistema pueden tener prioridad.</div></div></section>`};
 const tabs=[['general','Apariencia y espacio'],['backups','Copias de seguridad'],['privacy','Privacidad'],['shortcuts','Atajos']];
 content.innerHTML=pageHeader('TU CONFIGURACIÓN','Configuración','Ajusta tu espacio y mantén tus datos bajo tu control.')+`<div class="settings-grid"><nav class="settings-nav" aria-label="Secciones de configuración">${tabs.map(([id,label])=>`<button data-settings-tab="${id}" class="${activeSettingsTab===id?'active':''}">${label}</button>`).join('')}</nav><div class="settings-panel">${panels[activeSettingsTab]||panels.general}</div></div>`;
 bindSettingsHandlers();
}
function bindSettingsHandlers() {
 $('#identityForm')?.addEventListener('submit',async e=>{e.preventDefault();const meta=getMeta();meta.name=$('#appName').value.trim()||APP_LABEL;meta.profileName=$('#profileNameInput').value.trim()||'Paula';meta.greeting=$('#greetingInput').value.trim();meta.description=$('#descriptionInput').value.trim();await putOne('metadata',meta);await loadAll();toast('Se actualizaron los detalles del espacio.');render();});
 $('#darkThemeCheck')?.addEventListener('change',e=>{setTheme(e.target.checked?'dark':'light');render();});
 $('#compactSidebarCheck')?.addEventListener('change',e=>{setSidebarCollapsed(e.target.checked);});
 $('#refreshStorageBtn')?.addEventListener('click',async()=>{lastStorageEstimate=await estimateStorage();renderSettings();});
 $('#persistStorageBtn')?.addEventListener('click',async()=>{const r=await requestPersistence();const out=$('#persistResult');if(out)out.textContent=!r.supported?'Este navegador no permite solicitar persistencia.':r.persisted?'El navegador concedió almacenamiento persistente para este origen.':'El navegador no concedió persistencia; las copias siguen siendo importantes.';});
 $$('#notificationPermissionBtn').forEach(btn=>btn.addEventListener('click',async()=>{if(!('Notification'in window)){toast('Este navegador no admite notificaciones.','warning');return;}try{const result=await Notification.requestPermission();toast(result==='granted'?'Notificaciones activadas.':'No se concedió permiso para notificaciones.',result==='granted'?'success':'warning');renderSettings();}catch{toast('No se pudo solicitar el permiso de notificaciones.','error');}}));
 $('#exportBackupBtn')?.addEventListener('click',()=>exportBackup(false));
 $('#exportEncryptedBtn')?.addEventListener('click',()=>openEncryptExportModal());
 $('#importBackupBtn')?.addEventListener('click',()=>$('#backupFileInput').click());
 $('#backupFileInput')?.addEventListener('change',handleImportFile);
 $('#clearAllDataBtn')?.addEventListener('click',confirmClearData);
}
function renderEditor() {
 const data=currentEditorType==='diary'?dbData.diary.find(n=>n.id===currentNoteId):dbData.notes.find(n=>n.id===currentNoteId);
 if(!data){currentView='notas';render();return;}
 const folderOptions=`<option value="">Sin carpeta</option>${dbData.folders.map(f=>`<option value="${esc(f.id)}" ${data.folderId===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}`;
 $('#breadcrumbs').innerHTML=`<span>Tu espacio</span><span class="crumb-sep">/</span><strong>${esc(data.title||'Sin título')}</strong>`;
 content.innerHTML=`<div class="editor-shell"><div class="editor-toolbar-top"><button class="back-link" data-action="back-from-editor">${icon('arrow-left',16)} Volver</button><div id="saveStatus" class="save-status saved"><span class="pip"></span><span>Guardado</span></div></div><div class="editor-properties"><span>${icon('clock',13)} Creada ${dateLabel(data.createdAt,{year:true})||'hoy'}</span><span>${icon('refresh-cw',13)} Editada ${relativeTime(data.updatedAt)}</span><span>${icon(currentEditorType==='diary'?'book-open':'file-text',13)} ${currentEditorType==='diary'?'Entrada del diario':data.inbox?'Captura rápida':data.type==='draft'?'Borrador':'Nota'}</span></div><label class="sr-only" for="editorTitle">Título de la nota</label><textarea id="editorTitle" class="editor-title" rows="1" maxlength="500" placeholder="Sin título">${esc(data.title||'')}</textarea><div class="editor-subtitle">${currentEditorType==='diary'?'Escribe como te salga. No necesitas ordenar las ideas ahora.':'Un espacio amplio para desarrollar tus ideas.'}</div><div class="editor-actions" role="toolbar" aria-label="Herramientas de texto"><button class="tool-btn" data-format="bold" title="Negrita: **texto**">${icon('bold',16)}</button><button class="tool-btn" data-format="italic" title="Cursiva: *texto*">${icon('italic',16)}</button><span class="tool-sep"></span><button class="tool-btn" data-format="heading" title="Título">H2</button><button class="tool-btn" data-format="list" title="Lista con viñetas">${icon('list',16)}</button><button class="tool-btn" data-format="task" title="Lista de tareas">${icon('list-check',16)}</button><button class="tool-btn" data-format="quote" title="Cita">${icon('quote',15)}</button><span class="tool-sep"></span><button class="tool-btn" data-format="undo" title="Deshacer">${icon('undo',15)}</button><button class="tool-btn" data-format="redo" title="Rehacer">${icon('redo',15)}</button><span class="editor-wordcount" id="wordCount">0 palabras · 0 caracteres</span></div><label class="sr-only" for="editorBody">Contenido de la nota</label><textarea id="editorBody" class="editor-body" spellcheck="true" placeholder="Empieza a escribir aquí…">${esc(data.content||'')}</textarea><div class="editor-bottom"><div class="editor-bottom-actions"><label class="meta-field">${icon('folder',13)}<select id="editorFolder" aria-label="Carpeta">${folderOptions}</select></label><label class="meta-field">${icon('tag',13)}<input id="editorTags" aria-label="Etiquetas separadas por coma" placeholder="Etiquetas…" value="${esc((data.tags||[]).join(', '))}"></label>${currentEditorType!=='diary'?`<button class="button-quiet button-small" data-action="editor-favorite">${icon('star',14)} ${data.favorite?'Quitar favorito':'Favorito'}</button>`:''}</div><div class="editor-bottom-actions"><button class="button-quiet button-small" data-action="export-md">MD</button><button class="button-quiet button-small" data-action="export-txt">TXT</button>${currentEditorType!=='diary'?`<button class="button-quiet button-small" data-action="versions">${icon('clock',13)} Historial</button><button class="button-quiet button-small" data-action="editor-more">${icon('more-horizontal',15)}</button>`:''}</div><div class="editor-info" id="editorModified">Último cambio: ${dateLabel(data.updatedAt,{year:true,time:true})||'ahora'}</div></div></div>`;
 editorGeneration=0;editorSavedGeneration=0;editorDirty=false;lastSavedContent=data.content||'';lastVersionAt=0;editorHistory=[data.content||''];editorHistoryIndex=0;editorSessionId++;
 const titleEl=$('#editorTitle'), bodyEl=$('#editorBody');
 const resizeTitle=()=>{titleEl.style.height='auto';titleEl.style.height=Math.max(54,titleEl.scrollHeight)+'px';};
 resizeTitle();titleEl.addEventListener('input',()=>{resizeTitle(); editorChanged();});bodyEl.addEventListener('input',()=>{const value=bodyEl.value;if(editorHistory[editorHistoryIndex]!==value){editorHistory=editorHistory.slice(0,editorHistoryIndex+1);editorHistory.push(value);if(editorHistory.length>120)editorHistory.shift();editorHistoryIndex=editorHistory.length-1;}updateWordCount();editorChanged();});
 $('#editorFolder').addEventListener('change',editorChanged);$('#editorTags').addEventListener('change',editorChanged);
 bodyEl.addEventListener('keydown',e=>{if(e.key==='Tab'&&!e.shiftKey){e.preventDefault();const a=bodyEl.selectionStart,b=bodyEl.selectionEnd;bodyEl.setRangeText('  ',a,b,'end');editorChanged();updateWordCount();}});
 updateWordCount();
}
function updateWordCount() {
 const body=$('#editorBody'); if(!body)return;const s=body.value;const words=s.trim()?s.trim().split(/\s+/u).length:0;$('#wordCount').textContent=`${words.toLocaleString('es-CO')} ${words===1?'palabra':'palabras'} · ${s.length.toLocaleString('es-CO')} caracteres`;
}
function editorChanged() {
 editorGeneration++;editorDirty=true;setEditorStatus('writing');
 clearTimeout(editorTimer);editorTimer=setTimeout(()=>saveEditor(),500);
}
function snapshotEditor() {
 const data=currentEditorType==='diary'?dbData.diary.find(n=>n.id===currentNoteId):dbData.notes.find(n=>n.id===currentNoteId);
 if(!data)return null;
 return {...data,title:$('#editorTitle')?.value||'',content:$('#editorBody')?.value||'',folderId:$('#editorFolder')?.value||null,tags:($('#editorTags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean).slice(0,30),updatedAt:nowISO(),_generation:editorGeneration,_sessionId:editorSessionId};
}
async function saveEditor(force=false) {
 if(currentView!=='editor')return;
 clearTimeout(editorTimer);const snapshot=snapshotEditor();if(!snapshot)return;
 if(!force&&snapshot._generation===editorSavedGeneration)return;
 const generation=snapshot._generation;
 const sessionId=snapshot._sessionId;
 const typeAtSave=currentEditorType;
 const store=typeAtSave==='diary'?'diary':'notes';
 setEditorStatus('saving');
 saveChain=saveChain.then(async()=>{
   // Do not let an older pending write replace a newer edit in the same editor session.
   if(sessionId===editorSessionId && generation<editorGeneration){setEditorStatus('writing');return;}
   const old=await getOne(store,snapshot.id);
   const record={...snapshot};delete record._generation;delete record._sessionId;
   if(typeAtSave==='diary') record.entryDate=record.entryDate||dayKey(record.createdAt||nowISO());
   if(old && (old.content||'')!==(record.content||'') && (old.content||'').length>25 && Date.now()-lastVersionAt>30000){
     const version={id:uid(),noteId:old.id,title:old.title||'',content:old.content||'',savedAt:nowISO(),reason:'Guardado automático'};await putOne('versions',version);dbData.versions.push(version);lastVersionAt=Date.now();
   }
   for(const tagName of (record.tags||[])){const key=tagName.toLocaleLowerCase('es');if(!dbData.tags.some(t=>(t.name||'').toLocaleLowerCase('es')===key)){const tagRecord={id:uid(),name:tagName,createdAt:nowISO()};await putOne('tags',tagRecord);dbData.tags.push(tagRecord);}}
   await putOne(store,record);
   const idx=dbData[store].findIndex(n=>n.id===record.id);if(idx>=0)dbData[store][idx]=record;else dbData[store].push(record);
   if(sessionId===editorSessionId && generation===editorGeneration && currentNoteId===record.id && currentEditorType===typeAtSave){editorSavedGeneration=generation;lastSavedContent=record.content||'';editorDirty=false;setEditorStatus('saved',`a las ${new Intl.DateTimeFormat('es-CO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Bogota'}).format(new Date(record.updatedAt))}`);const modified=$('#editorModified');if(modified)modified.textContent=`Último cambio: ${dateLabel(record.updatedAt,{year:true,time:true})}`;renderSidebar();}
 }).catch(err=>{setEditorStatus('error');setStorageStatus('Error de guardado','error');toast(`No se pudo guardar este texto: ${err.message||'error de almacenamiento'}. Copia tu texto antes de salir.`, 'error');});
 await saveChain;
}
async function createNote({type='note',title='',content='',inbox=false,folderId=null,tags=[]}={}) {
 if(currentView==='editor') await saveEditor(true);
 editorReturnView=(currentView==='inicio'||currentView==='configuracion'||currentView==='editor')?'notas':currentView;
 const now=nowISO();const note={id:uid(),type,title,content,folderId,tags,inbox,state:type==='draft'?'draft':'active',favorite:false,createdAt:now,updatedAt:now,archivedAt:null,deletedAt:null};
 await putOne('notes',note);dbData.notes.push(note);currentEditorType='note';currentNoteId=note.id;currentView='editor';render();setTimeout(()=>$('#editorTitle')?.focus(),30);return note;
}
async function createDiary() {
 if(currentView==='editor') await saveEditor(true);
 editorReturnView='diario';
 const now=nowISO();const entry={id:uid(),title:'',content:'',tags:[],entryDate:dayKey(now),createdAt:now,updatedAt:now};await putOne('diary',entry);dbData.diary.push(entry);currentEditorType='diary';currentNoteId=entry.id;currentView='editor';render();setTimeout(()=>$('#editorBody')?.focus(),30);
}
function showModal(title, subtitle, body, actions='') {
 lastFocusedBeforeModal=document.activeElement;
 modal.innerHTML=`<div class="modal-head"><div><h2 id="modalTitle">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="modal-close" data-modal-close aria-label="Cerrar">${icon('x',17)}</button></div>${body}${actions?`<div class="modal-actions">${actions}</div>`:''}`;
 modalBackdrop.hidden=false;updateIconElements(modal);setTimeout(()=>$('input:not([type=hidden]),textarea,select,button',modal)?.focus(),20);
}
function closeModal() { modalBackdrop.hidden=true;modal.innerHTML='';pendingImport=null;lastFocusedBeforeModal?.focus?.(); }
function showQuickCapture() {
 showModal('Capturar una idea','Guárdala primero. Podrás organizarla después.',`<form id="captureForm" class="modal-form"><div class="field"><label for="captureTitle">Título (opcional)</label><input class="form-control" id="captureTitle" maxlength="500" placeholder="Una idea que no quiero perder"></div><div class="field"><label for="captureContent">Texto</label><textarea class="form-control" id="captureContent" required placeholder="Pega aquí lo que quieras guardar…"></textarea><div class="form-help">Se conservan los saltos de línea. También puedes capturar varios párrafos de una vez.</div></div><label class="field" style="display:block"><span><input type="checkbox" id="captureDraft"> Guardar como borrador en vez de bandeja de entrada</span></label><div class="modal-actions"><button type="button" class="button-secondary" data-modal-close>Cancelar</button><button type="submit" class="button">Guardar texto</button></div></form>`);
 $('#captureForm').addEventListener('submit',async e=>{e.preventDefault();const title=$('#captureTitle').value.trim(),value=$('#captureContent').value;if(!value.trim()){toast('Escribe o pega algún contenido antes de guardar.','warning');return;}const note=await createNote({type:$('#captureDraft').checked?'draft':'capture',title,content:value,inbox:!$('#captureDraft').checked});closeModal();toast('La idea quedó guardada en este dispositivo.');currentView='inbox';render();});
}
function showFolderModal() {
 showModal('Nueva carpeta','Ponle un nombre corto que te ayude a encontrar tus textos.',`<form id="folderForm" class="modal-form"><div class="field"><label for="folderName">Nombre</label><input class="form-control" id="folderName" maxlength="80" placeholder="Por ejemplo: Ideas para después" required></div><div class="field"><label for="folderDescription">Descripción (opcional)</label><input class="form-control" id="folderDescription" maxlength="180" placeholder="Qué quieres reunir aquí"></div><div class="modal-actions"><button type="button" class="button-secondary" data-modal-close>Cancelar</button><button class="button" type="submit">Crear carpeta</button></div></form>`);
 $('#folderForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('#folderName').value.trim();if(!name)return;const folder={id:uid(),name,description:$('#folderDescription').value.trim(),order:dbData.folders.length,createdAt:nowISO()};await putOne('folders',folder);dbData.folders.push(folder);closeModal();render();toast('Carpeta creada.');});
}
function taskModal(task=null) {
 showModal(task?'Editar tarea':'Nueva tarea','Puedes dejar en blanco los campos que no necesites.',`<form id="taskForm" class="modal-form"><div class="field"><label for="taskTitle">Qué quieres hacer</label><input class="form-control" id="taskTitle" maxlength="250" required value="${esc(task?.title||'')}" placeholder="Escribe una tarea"></div><div class="field"><label for="taskDesc">Descripción</label><textarea class="form-control" id="taskDesc" rows="3" placeholder="Detalles opcionales">${esc(task?.description||'')}</textarea></div><div class="form-columns"><div class="field"><label for="taskDue">Fecha límite</label><input class="form-control" id="taskDue" type="date" value="${esc(task?.dueAt||'')}"></div><div class="field"><label for="taskPriority">Prioridad</label><select class="form-control" id="taskPriority"><option value="">Sin prioridad</option>${['Baja','Media','Alta'].map(p=>`<option ${task?.priority===p?'selected':''}>${p}</option>`).join('')}</select></div></div><div class="modal-actions"><button type="button" class="button-secondary" data-modal-close>Cancelar</button><button class="button" type="submit">${task?'Guardar cambios':'Crear tarea'}</button></div></form>`);
 $('#taskForm').addEventListener('submit',async e=>{e.preventDefault();const now=nowISO();const item={...(task||{}),id:task?.id||uid(),title:$('#taskTitle').value.trim(),description:$('#taskDesc').value.trim(),dueAt:$('#taskDue').value||null,priority:$('#taskPriority').value||null,done:task?.done||false,createdAt:task?.createdAt||now,updatedAt:now};await putOne('tasks',item);const i=dbData.tasks.findIndex(t=>t.id===item.id);if(i>=0)dbData.tasks[i]=item;else dbData.tasks.push(item);closeModal();render();toast(task?'Tarea actualizada.':'Tarea creada.');});
}
function eventModal(event=null, prefillDate=null) {
 const baseStart=event?.startAt?localInputDateTime(event.startAt):`${prefillDate||dayKey(new Date())}T09:00`;
 const baseEnd=event?.endAt?localInputDateTime(event.endAt):`${prefillDate||dayKey(new Date())}T10:00`;
 showModal(event?'Editar evento':'Nuevo evento','Los horarios se interpretan en America/Bogota.',`<form id="eventForm" class="modal-form"><div class="field"><label for="eventTitle">Nombre del evento</label><input class="form-control" id="eventTitle" maxlength="250" required value="${esc(event?.title||'')}" placeholder="Un plan, una cita, algo que recordar"></div><div class="field"><label for="eventDescription">Descripción (opcional)</label><textarea class="form-control" id="eventDescription" rows="2">${esc(event?.description||'')}</textarea></div><div class="form-columns"><div class="field"><label for="eventStart">Empieza</label><input class="form-control" id="eventStart" type="datetime-local" required value="${esc(baseStart)}"></div><div class="field"><label for="eventEnd">Termina</label><input class="form-control" id="eventEnd" type="datetime-local" value="${esc(baseEnd)}"></div></div><div class="form-columns"><div class="field"><label for="eventReminder">Aviso previo</label><select class="form-control" id="eventReminder"><option value="0">Sin aviso</option><option value="5" ${event?.reminderMinutes===5?'selected':''}>5 minutos</option><option value="15" ${event?.reminderMinutes===15?'selected':''}>15 minutos</option><option value="30" ${event?.reminderMinutes===30?'selected':''}>30 minutos</option><option value="60" ${event?.reminderMinutes===60?'selected':''}>1 hora</option><option value="1440" ${event?.reminderMinutes===1440?'selected':''}>1 día</option></select></div><div class="field"><label for="eventCategory">Categoría (opcional)</label><input class="form-control" id="eventCategory" maxlength="80" value="${esc(event?.category||'')}" placeholder="Personal, estudio…"></div></div><p class="modal-note">Las notificaciones se revisan mientras la aplicación esté abierta y el navegador permita mostrarlas. No se garantiza una alarma con la página cerrada.</p><div class="modal-actions">${event?'<button type="button" class="button-danger" id="deleteEventBtn">Eliminar</button>':''}<button type="button" class="button-secondary" data-modal-close>Cancelar</button><button class="button" type="submit">${event?'Guardar cambios':'Crear evento'}</button></div></form>`);
 $('#eventForm').addEventListener('submit',async e=>{e.preventDefault();const start=dateFromLocalInput($('#eventStart').value);const end=dateFromLocalInput($('#eventEnd').value);if(end&&new Date(end)<new Date(start)){toast('La hora de finalización debe ser posterior al inicio.','warning');return;}const now=nowISO();const reminderMinutes=Number($('#eventReminder').value);const item={...(event||{}),id:event?.id||uid(),title:$('#eventTitle').value.trim(),description:$('#eventDescription').value.trim(),startAt:start,endAt:end,reminderMinutes,category:$('#eventCategory').value.trim(),remindedAt:event?.startAt===start&&event?.reminderMinutes===reminderMinutes?event?.remindedAt||null:null,createdAt:event?.createdAt||now,updatedAt:now};await putOne('events',item);const i=dbData.events.findIndex(x=>x.id===item.id);if(i>=0)dbData.events[i]=item;else dbData.events.push(item);
  const oldReminder=dbData.reminders.find(r=>r.sourceType==='event'&&r.sourceId===item.id);
  if(reminderMinutes>0){const reminder={id:`event-${item.id}`,sourceType:'event',sourceId:item.id,triggerAt:new Date(new Date(start).getTime()-reminderMinutes*60000).toISOString(),state:event&&event.startAt===start&&event.reminderMinutes===reminderMinutes?(oldReminder?.state||'pending'):'pending',channel:'internal+browser',remindedAt:event&&event.startAt===start&&event.reminderMinutes===reminderMinutes?oldReminder?.remindedAt||null:null,createdAt:oldReminder?.createdAt||now,updatedAt:now};await putOne('reminders',reminder);const ri=dbData.reminders.findIndex(r=>r.id===reminder.id);if(ri>=0)dbData.reminders[ri]=reminder;else dbData.reminders.push(reminder);}else if(oldReminder){await deleteOne('reminders',oldReminder.id);dbData.reminders=dbData.reminders.filter(r=>r.id!==oldReminder.id);}
  closeModal();currentView='calendario';render();toast(event?'Evento actualizado.':'Evento creado.');});
 $('#deleteEventBtn')?.addEventListener('click',async()=>{if(!confirm('¿Eliminar este evento?'))return;await deleteOne('events',event.id);dbData.events=dbData.events.filter(x=>x.id!==event.id);const reminderId=`event-${event.id}`;await deleteOne('reminders',reminderId);dbData.reminders=dbData.reminders.filter(r=>r.id!==reminderId);closeModal();render();toast('Evento eliminado.');});
}
function collectionModal(collection=null) {
 showModal(collection?'Editar colección':'Nueva colección','Una colección puede ser cualquier lista que quieras organizar.',`<form id="collectionForm" class="modal-form"><div class="field"><label for="collectionName">Nombre</label><input class="form-control" id="collectionName" maxlength="100" required value="${esc(collection?.name||'')}" placeholder="Ideas, lecturas, proyectos…"></div><div class="field"><label for="collectionDescription">Descripción</label><textarea class="form-control" id="collectionDescription" rows="2">${esc(collection?.description||'')}</textarea></div><div class="modal-actions">${collection?'<button class="button-danger" type="button" id="deleteCollectionBtn">Eliminar colección</button>':''}<button type="button" class="button-secondary" data-modal-close>Cancelar</button><button type="submit" class="button">${collection?'Guardar':'Crear colección'}</button></div></form>`);
 $('#collectionForm').addEventListener('submit',async e=>{e.preventDefault();const item={...(collection||{}),id:collection?.id||uid(),name:$('#collectionName').value.trim(),description:$('#collectionDescription').value.trim(),items:collection?.items||[],createdAt:collection?.createdAt||nowISO(),updatedAt:nowISO()};await putOne('collections',item);const i=dbData.collections.findIndex(c=>c.id===item.id);if(i>=0)dbData.collections[i]=item;else dbData.collections.push(item);closeModal();currentView='colecciones';render();toast(collection?'Colección actualizada.':'Colección creada.');});
 $('#deleteCollectionBtn')?.addEventListener('click',async()=>{if(!confirm('¿Eliminar la colección y sus registros?'))return;await deleteOne('collections',collection.id);dbData.collections=dbData.collections.filter(c=>c.id!==collection.id);closeModal();currentView='colecciones';render();toast('Colección eliminada.');});
}
function collectionItemModal(collectionId) {
 const c=dbData.collections.find(x=>x.id===collectionId);if(!c)return;
 showModal('Añadir elemento',`Se guardará en «${esc(c.name)}».`,`<form id="collectionItemForm" class="modal-form"><div class="field"><label for="collectionItemTitle">Nombre del elemento</label><input class="form-control" id="collectionItemTitle" maxlength="300" required placeholder="Escribe un elemento"></div><div class="form-columns"><div class="field"><label for="collectionItemStatus">Estado</label><select class="form-control" id="collectionItemStatus"><option>Pendiente</option><option>En curso</option><option>Listo</option><option>En pausa</option></select></div><div class="field"><label for="collectionItemDate">Fecha (opcional)</label><input class="form-control" id="collectionItemDate" type="date"></div></div><div class="modal-actions"><button type="button" class="button-secondary" data-modal-close>Cancelar</button><button type="submit" class="button">Guardar elemento</button></div></form>`);
 $('#collectionItemForm').addEventListener('submit',async e=>{e.preventDefault();const item={id:uid(),title:$('#collectionItemTitle').value.trim(),status:$('#collectionItemStatus').value,date:$('#collectionItemDate').value||null,createdAt:nowISO()};c.items=[...(c.items||[]),item];c.updatedAt=nowISO();await putOne('collections',c);closeModal();renderCollectionDetail(c.id);toast('Elemento añadido.');});
}
function formatSelection(format) {
 const el=$('#editorBody');if(!el)return;
 const start=el.selectionStart,end=el.selectionEnd,selected=el.value.slice(start,end),lineStart=el.value.lastIndexOf('\n',start-1)+1;
 let before='',after='',replacement=selected;
 if(format==='bold'){before='**';after='**';}
 else if(format==='italic'){before='*';after='*';}
 else if(format==='heading'){replacement=`## ${selected||'Título'}`;}
 else if(format==='list'){replacement=(selected||'Elemento').split('\n').map(s=>`- ${s}`).join('\n');}
 else if(format==='task'){replacement=(selected||'Tarea').split('\n').map(s=>`- [ ] ${s}`).join('\n');}
 else if(format==='quote'){replacement=(selected||'Cita').split('\n').map(s=>`> ${s}`).join('\n');}
 else if(format==='undo'||format==='redo'){const next=format==='undo'?editorHistoryIndex-1:editorHistoryIndex+1;if(next<0||next>=editorHistory.length)return;editorHistoryIndex=next;el.value=editorHistory[editorHistoryIndex];el.focus();el.setSelectionRange(el.value.length,el.value.length);editorChanged();updateWordCount();return;}
 const text=format==='bold'||format==='italic'?before+selected+after:replacement;
 el.setRangeText(text,start,end,'select');el.focus();if(before){el.setSelectionRange(start+before.length,start+before.length+selected.length);}editorChanged();updateWordCount();
}
async function toggleFavorite() {
 await saveEditor(true);
 const item=dbData.notes.find(n=>n.id===currentNoteId);if(!item)return;item.favorite=!item.favorite;item.updatedAt=nowISO();await putOne('notes',item);render();toast(item.favorite?'Añadida a favoritos.':'Quitada de favoritos.');
}
async function exportNote(format) {
 await saveEditor(true);
 const item=currentEditorType==='diary'?dbData.diary.find(n=>n.id===currentNoteId):dbData.notes.find(n=>n.id===currentNoteId);if(!item)return;
 const title=item.title||'Sin título';const body=(format==='md'?`# ${title}\n\n`:'')+(item.content||'');const blob=new Blob([body],{type:format==='md'?'text/markdown;charset=utf-8':'text/plain;charset=utf-8'});downloadBlob(blob,`${slug(title)}.${format}`);toast(`Texto exportado como ${format.toUpperCase()}.`);
}
async function showVersions() {
 if(currentEditorType==='diary'){toast('El historial de versiones está disponible para notas; exporta esta entrada como respaldo si necesitas conservar una versión externa.','warning');return;}
 await saveEditor(true);const versions=dbData.versions.filter(v=>v.noteId===currentNoteId).sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt));
 showModal('Historial de versiones','Las versiones anteriores se conservan como copias recuperables.',versions.length?`<div>${versions.map(v=>`<div class="version-row"><div class="version-row-copy"><strong>${esc(v.title||'Sin título')}</strong><span>${dateLabel(v.savedAt,{year:true,time:true})} · ${esc(v.reason||'Versión guardada')}</span></div><button class="button-secondary button-small" data-preview-version="${esc(v.id)}">Ver</button><button class="button-secondary button-small" data-restore-version="${esc(v.id)}">Restaurar</button></div>`).join('')}</div>`:`<div class="empty-state"><h3>Aún no hay versiones</h3><p>Se crea un registro recuperable cuando una nota cambia después de varios guardados.</p></div>`);
}
async function createBackupPayload() {
 const metadata=getMeta(); metadata.lastBackupAt=nowISO();await putOne('metadata',metadata);dbData.metadata=dbData.metadata.filter(m=>m.id!=='app-meta').concat(metadata);
 const entries=await Promise.all(STORES.map(s=>getAll(s)));
 return {app:'entre-lineas',format:'entre-lineas-backup',version:2,exportedAt:nowISO(),data:Object.fromEntries(STORES.map((s,i)=>[s,entries[i]]))};
}
async function exportBackup(encrypted=false, password='') {
 try {
  const payload=await createBackupPayload();const raw=new TextEncoder().encode(JSON.stringify(payload));
  let blob,filename;
  if(encrypted){const envelope=await encryptBytes(raw,password);blob=new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'});filename=`entre-lineas-copia-cifrada-${dayKey(new Date())}.json`;}
  else {blob=new Blob([raw],{type:'application/json'});filename=`entre-lineas-copia-${dayKey(new Date())}.json`;}
  downloadBlob(blob,filename);toast(encrypted?'Copia cifrada preparada para descargar.':'Copia completa preparada para descargar.');if(currentView==='configuracion')renderSettings();
 }catch(e){toast(`No se pudo exportar la copia: ${e.message||'error desconocido'}.`,'error');}
}
async function deriveKey(password,salt) {
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function toBase64(buffer) {let bin='';new Uint8Array(buffer).forEach(b=>bin+=String.fromCharCode(b));return btoa(bin);}
function fromBase64(str) {const bin=atob(str);return Uint8Array.from(bin,c=>c.charCodeAt(0));}
async function encryptBytes(bytes,password) {
 if(!crypto?.subtle)throw new Error('Web Crypto no está disponible. Usa HTTPS o localhost.');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await deriveKey(password,salt);const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);
 return {format:'entre-lineas-encrypted-backup',version:1,kdf:'PBKDF2-SHA-256',iterations:250000,cipher:'AES-GCM-256',salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(ciphertext),warning:'La contraseña no se incluye en el archivo. Si la olvidas, no se puede recuperar el contenido.'};
}
async function decryptEnvelope(envelope,password) {
 if(envelope.format!=='entre-lineas-encrypted-backup'||envelope.version!==1)throw new Error('El formato de la copia cifrada no es compatible.');const key=await deriveKey(password,fromBase64(envelope.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(envelope.iv)},key,fromBase64(envelope.ciphertext));return JSON.parse(new TextDecoder().decode(plain));
}
function openEncryptExportModal() {
 showModal('Crear copia cifrada','La contraseña cifra el archivo descargado. No se guarda en la aplicación y no puede recuperarse si la olvidas.',`<form id="encryptForm" class="modal-form"><div class="field"><label for="backupPassword">Contraseña para la copia</label><input class="form-control" type="password" id="backupPassword" minlength="10" autocomplete="new-password" required placeholder="Al menos 10 caracteres"></div><div class="field"><label for="backupPassword2">Repite la contraseña</label><input class="form-control" type="password" id="backupPassword2" minlength="10" autocomplete="new-password" required></div><div class="callout warning">${icon('lock',15)}<div>Este cifrado protege el archivo exportado. La base de datos local de esta app no queda cifrada por esta función.</div></div><div class="modal-actions"><button class="button-secondary" type="button" data-modal-close>Cancelar</button><button class="button" type="submit">Cifrar y exportar</button></div></form>`);
 $('#encryptForm').addEventListener('submit',async e=>{e.preventDefault();const p=$('#backupPassword').value;if(p!==$('#backupPassword2').value){toast('Las contraseñas no coinciden.','warning');return;}if(p.length<10){toast('Usa una contraseña de al menos 10 caracteres.','warning');return;}closeModal();await exportBackup(true,p);});
}
function validateBackup(obj) {
 if(!obj||obj.format!=='entre-lineas-backup'||obj.app!=='entre-lineas'||![1,2].includes(obj.version)||!obj.data||typeof obj.data!=='object')throw new Error('El archivo no tiene el formato de copia de Entre Líneas.');
 const data={};for(const s of STORES){const list=obj.data[s];if(!Array.isArray(list)){if(obj.version===1&&['reminders','attachments'].includes(s)){data[s]=[];continue;}throw new Error(`Falta la lista «${s}» o no tiene un formato válido.`);}if(list.length>200000)throw new Error(`La lista «${s}» supera el límite de validación.`);data[s]=list;const seen=new Set();for(const item of data[s]){if(!item||typeof item!=='object'||typeof item.id!=='string')throw new Error(`Hay un registro inválido en «${s}».`);if(seen.has(item.id))throw new Error(`Hay identificadores duplicados dentro de «${s}». La copia no se importó para evitar sobrescrituras.`);seen.add(item.id);}}
 return {app:obj.app,format:obj.format,version:2,exportedAt:obj.exportedAt||null,data};
}
async function handleImportFile(e) {
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 if(file.size>100*1024*1024){toast('La copia supera el límite de 100 MB para esta importación.','error');return;}
 try {
  let parsed=JSON.parse(await file.text());
  if(parsed.format==='entre-lineas-encrypted-backup'){
   parsed=await new Promise((resolve,reject)=>{
    showModal('Desbloquear copia cifrada','Escribe la contraseña que elegiste cuando exportaste este archivo.',`<form id="decryptForm" class="modal-form"><div class="field"><label for="decryptPassword">Contraseña</label><input class="form-control" type="password" id="decryptPassword" required autocomplete="current-password"></div><div class="modal-actions"><button class="button-secondary" type="button" data-modal-close>Cancelar</button><button class="button" type="submit">Descifrar archivo</button></div></form>`);
    $('#decryptForm').addEventListener('submit',async ev=>{ev.preventDefault();try{const result=await decryptEnvelope(parsed,$('#decryptPassword').value);closeModal();resolve(result);}catch{toast('No se pudo descifrar. Comprueba la contraseña y el archivo.','error');}});
   });
  }
  const backup=validateBackup(parsed);const counts=Object.fromEntries(STORES.map(s=>[s,backup.data[s].length]));pendingImport={backup,filename:file.name,counts};
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  showModal('Revisar restauración',`Archivo: ${esc(file.name)} · ${total.toLocaleString('es-CO')} registros validados`, `<div class="privacy-note">La copia se ha validado sin ejecutar su contenido. Revisa las cantidades antes de continuar.</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:15px 0">${STORES.map(s=>`<div class="meta-field" style="justify-content:space-between"><span>${esc(s)}</span><strong>${counts[s]}</strong></div>`).join('')}</div><div class="field"><label for="importMode">Modo de importación</label><select class="form-control" id="importMode"><option value="merge">Combinar sin sobrescribir registros existentes</option><option value="replace">Reemplazar todos los datos locales actuales</option></select><div class="form-help">Combinar omite identificadores que ya existen para evitar sobrescrituras. Reemplazar requiere confirmar y descargará primero una copia del estado actual.</div><div class="privacy-note" id="importPlanSummary">Calculando cuántos registros se añadirán…</div></div><div class="callout warning">${icon('circle-alert',15)}<div>Conserva las copias exportadas de forma segura. Esta importación no sincroniza ni sube datos a internet.</div></div><div class="modal-actions"><button class="button-secondary" type="button" data-modal-close>Cancelar</button><button class="button" id="confirmImportBtn" type="button">Continuar importación</button></div>`);
  const updateImportPlan=async()=>{const mode=$('#importMode')?.value||'merge';let willImport=0,willSkip=0;for(const store of STORES){if(mode==='replace'){willImport+=backup.data[store].length;continue;}const existing=new Set((await getAll(store)).map(x=>x.id));for(const item of backup.data[store]){if(existing.has(item.id))willSkip++;else willImport++;}}const summary=$('#importPlanSummary');if(summary)summary.textContent=mode==='replace'?`Se reemplazarán ${willImport.toLocaleString('es-CO')} registros con el contenido del archivo. Se descargará una copia del estado actual antes de cambiar los datos.`:`Se añadirán ${willImport.toLocaleString('es-CO')} registros nuevos y se omitirán ${willSkip.toLocaleString('es-CO')} con identificadores ya existentes.`;};
  $('#importMode').addEventListener('change',updateImportPlan);updateImportPlan();
  $('#confirmImportBtn').addEventListener('click',applyImport);
 } catch(err) { closeModal();toast(`No se pudo importar la copia: ${err.message||'formato inválido'}`,'error'); }
}
async function applyImport() {
 if(!pendingImport)return;const {backup}=pendingImport;const mode=$('#importMode').value;
 if(mode==='replace'&&!confirm('Esto reemplazará todos los datos actuales. Se descargará primero un respaldo. ¿Continuar?'))return;
 try {
  const current=await createBackupPayload();
  downloadBlob(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}),`entre-lineas-respaldo-previo-${dayKey(new Date())}.json`);
  if(mode==='replace') {
   await replaceAll(backup.data);toast('Se descargó una copia del estado anterior antes del reemplazo.');
  } else {
   let added=0,skipped=0;
   for(const store of STORES){const existing=new Set((await getAll(store)).map(x=>x.id));const fresh=[];for(const item of backup.data[store]){if(existing.has(item.id)){skipped++;continue;}fresh.push(item);existing.add(item.id);}if(fresh.length){await putMany(store,fresh);added+=fresh.length;}}
   toast(`Importación combinada: ${added} registros añadidos y ${skipped} omitidos para no sobrescribir datos.`);
  }
  closeModal();await loadAll();currentView='inicio';render();if(mode==='replace')toast('Restauración completada. Revisa las notas y los datos restaurados.');
 }catch(err){toast(`La restauración no pudo terminar: ${err.message||'error'}. Revisa la copia previa descargada.`,'error');}
}
function confirmClearData() {
 showModal('Eliminar todos los datos locales','Esta operación no se puede deshacer desde la aplicación.',`<div class="callout warning">${icon('circle-alert',17)}<div>Se borrarán notas, diario, tareas, eventos, carpetas, colecciones y versiones de este origen del navegador. Exporta una copia antes de continuar.</div></div><div class="field" style="margin-top:15px"><label for="clearConfirmText">Escribe BORRAR para confirmar</label><input class="form-control" id="clearConfirmText" autocomplete="off"></div><div class="modal-actions"><button class="button-secondary" data-modal-close type="button">Cancelar</button><button class="button-danger" id="confirmClearAllBtn" type="button" disabled>Eliminar permanentemente</button></div>`);
 $('#clearConfirmText').addEventListener('input',e=>$('#confirmClearAllBtn').disabled=e.target.value!=='BORRAR');
 $('#confirmClearAllBtn').addEventListener('click',async()=>{for(const store of STORES) await clearStore(store);closeModal();await loadAll();currentView='inicio';render();toast('Se eliminaron los datos locales.','warning');});
}
async function confirmEmptyTrash() {
 const trash=dbData.notes.filter(n=>n.deletedAt);if(!trash.length){toast('La papelera ya está vacía.');return;}
 showModal('Vaciar papelera',`Se eliminarán definitivamente ${trash.length} notas.`, `<div class="callout warning">${icon('circle-alert',16)}<div>Esta acción no se puede deshacer. Crea una copia de seguridad si quieres conservar estos textos.</div></div><div class="modal-actions"><button class="button-secondary" data-modal-close>Cancelar</button><button class="button-danger" id="confirmEmptyTrash">Vaciar papelera</button></div>`);
 $('#confirmEmptyTrash').addEventListener('click',async()=>{for(const note of trash)await deleteOne('notes',note.id);dbData.notes=dbData.notes.filter(n=>!n.deletedAt);closeModal();render();toast('La papelera se ha vaciado.');});
}
async function showEditorMore() {
 await saveEditor(true);
 const item=dbData.notes.find(n=>n.id===currentNoteId);if(!item)return;
 showModal('Organizar nota','Acciones para este documento.',`<div class="modal-form"><button class="button-secondary wide" data-editor-move>${icon('folder',15)} Mover a una carpeta</button><button class="button-secondary wide" data-editor-state>${icon('file-pen-line',15)} ${item.state==='draft'?'Marcar como nota normal':'Marcar como borrador'}</button><button class="button-secondary wide" data-editor-inbox>${icon('inbox',15)} ${item.inbox?'Quitar de la bandeja':'Enviar a la bandeja'}</button><button class="button-secondary wide" data-editor-archive>${icon('archive',15)} ${item.archivedAt?'Recuperar de archivados':'Archivar nota'}</button><button class="button-danger wide" data-editor-delete>${icon('trash-2',15)} Mover a la papelera</button></div>`);
 $('[data-editor-move]').addEventListener('click',()=>{
  const options=`<form id="moveFolderForm" class="modal-form"><div class="field"><label for="moveFolderSelect">Destino</label><select class="form-control" id="moveFolderSelect"><option value="">Sin carpeta</option>${dbData.folders.map(f=>`<option value="${esc(f.id)}" ${item.folderId===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div><div class="modal-actions"><button class="button-secondary" type="button" data-modal-close>Cancelar</button><button class="button" type="submit">Mover</button></div></form>`;
  showModal('Mover nota','Selecciona la carpeta de destino.',options);$('#moveFolderForm').addEventListener('submit',async e=>{e.preventDefault();item.folderId=$('#moveFolderSelect').value||null;item.updatedAt=nowISO();await putOne('notes',item);closeModal();await loadAll();render();toast('Nota organizada.');});
 });
 $('[data-editor-state]').addEventListener('click',async()=>{item.state=item.state==='draft'?'active':'draft';item.type=item.state==='draft'?'draft':'note';item.updatedAt=nowISO();await putOne('notes',item);closeModal();await loadAll();render();toast('Estado de la nota actualizado.');});
 $('[data-editor-inbox]').addEventListener('click',async()=>{item.inbox=!item.inbox;item.updatedAt=nowISO();await putOne('notes',item);closeModal();await loadAll();render();toast(item.inbox?'Nota enviada a la bandeja.':'Nota organizada fuera de la bandeja.');});
 $('[data-editor-archive]').addEventListener('click',async()=>{item.archivedAt=item.archivedAt?null:nowISO();item.updatedAt=nowISO();await putOne('notes',item);closeModal();await loadAll();currentView=item.archivedAt?'archivados':'notas';render();toast(item.archivedAt?'Nota archivada.':'Nota recuperada de archivados.');});
 $('[data-editor-delete]').addEventListener('click',async()=>{if(!confirm('¿Mover esta nota a la papelera?'))return;item.deletedAt=nowISO();item.updatedAt=nowISO();await putOne('notes',item);closeModal();await loadAll();currentView='papelera';render();toast('Nota movida a la papelera.');});
}
async function openItem(id,type='note') {
 if(currentView==='editor')await saveEditor(true);
 editorReturnView=(type==='diary')?'diario':(currentView==='inicio'||currentView==='configuracion'||currentView==='editor')?'notas':currentView;
 currentNoteId=id;currentEditorType=type==='diary'?'diary':'note';currentView='editor';render();
}
async function handleDeleteOrRestore(id,view) {
 const note=dbData.notes.find(n=>n.id===id);if(!note)return;
 if(view==='papelera'){
  showModal('Recuperar nota',`«${esc(note.title||'Sin título')}» volverá a tus notas.`,`<div class="modal-actions"><button class="button-secondary" data-modal-close>Cancelar</button><button class="button" id="restoreNoteBtn">${icon('refresh-cw',14)} Recuperar</button><button class="button-danger" id="deleteForeverBtn">Eliminar definitivamente</button></div>`);
  $('#restoreNoteBtn').addEventListener('click',async()=>{note.deletedAt=null;note.updatedAt=nowISO();await putOne('notes',note);closeModal();await loadAll();render();toast('Nota recuperada.');});
  $('#deleteForeverBtn').addEventListener('click',async()=>{if(!confirm('Eliminar definitivamente esta nota?'))return;await deleteOne('notes',id);dbData.notes=dbData.notes.filter(n=>n.id!==id);for(const v of dbData.versions.filter(v=>v.noteId===id))await deleteOne('versions',v.id);dbData.versions=dbData.versions.filter(v=>v.noteId!==id);closeModal();render();toast('Nota eliminada definitivamente.');});
 } else {await openItem(id,note.type==='capture'?'capture':'note');}
}
function openSearch() { searchOverlay.hidden=false;searchInput.value='';searchActiveIndex=-1;searchResults.innerHTML='<div class="search-hint">Escribe para buscar en tu espacio.</div>';setTimeout(()=>searchInput.focus(),10); }
function closeSearch() { searchOverlay.hidden=true;searchInput.value=''; }
function searchEverything(q) {
 const query=q.trim().toLocaleLowerCase('es');if(!query)return [];
 const out=[];
 for(const n of dbData.notes){if(n.deletedAt)continue;const hay=`${n.title||''} ${n.content||''} ${(n.tags||[]).join(' ')}`.toLocaleLowerCase('es');if(hay.includes(query))out.push({id:n.id,type:n.type==='capture'?'capture':'note',title:n.title||'Sin título',preview:shortPreview(n.content,140),updatedAt:n.updatedAt});}
 for(const n of dbData.diary){if(`${n.title||''} ${n.content||''} ${(n.tags||[]).join(' ')}`.toLocaleLowerCase('es').includes(query))out.push({id:n.id,type:'diary',title:n.title||'Entrada del diario',preview:shortPreview(n.content,140),updatedAt:n.updatedAt});}
 for(const t of dbData.tasks){if(`${t.title} ${t.description||''}`.toLocaleLowerCase('es').includes(query))out.push({id:t.id,type:'task',title:t.title,preview:t.description||'Tarea',updatedAt:t.updatedAt});}
 for(const e of dbData.events){if(`${e.title} ${e.description||''}`.toLocaleLowerCase('es').includes(query))out.push({id:e.id,type:'event',title:e.title,preview:e.description||dateLabel(e.startAt,{year:true,time:true}),updatedAt:e.updatedAt});}
 for(const f of dbData.folders){if(`${f.name} ${f.description||''}`.toLocaleLowerCase('es').includes(query))out.push({id:f.id,type:'folder',title:f.name,preview:f.description||'Carpeta',updatedAt:f.createdAt});}
 return out.sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).slice(0,35);
}
function renderSearchResults() {
 const rows=searchEverything(searchInput.value);searchActiveIndex=-1;
 searchResults.innerHTML=rows.length?rows.map((r,i)=>`<button class="search-result" data-search-result="${i}" data-result-id="${esc(r.id)}" data-result-type="${esc(r.type)}"><span class="note-icon ${r.type==='capture'?'capture':r.type==='diary'?'diary':''}" style="width:31px;height:33px">${icon(r.type==='task'?'check-square':r.type==='event'?'calendar-days':r.type==='folder'?'folder':r.type==='diary'?'book-open':r.type==='capture'?'inbox':'file-text',15)}</span><span class="search-result-copy"><strong>${esc(r.title)}</strong><span>${esc(r.preview)}</span></span><span class="search-result-type">${esc({note:'Nota',capture:'Captura',diary:'Diario',task:'Tarea',event:'Evento',folder:'Carpeta'}[r.type]||r.type)}</span></button>`).join(''):'<div class="search-hint">No se encontraron coincidencias para esta búsqueda.</div>';
}
async function openSearchResult(id,type) {
 closeSearch();
 if(type==='diary')await openItem(id,'diary');
 else if(type==='note'||type==='capture')await openItem(id,type);
 else if(type==='task'){currentView='tareas';render();const t=dbData.tasks.find(t=>t.id===id);if(t)taskModal(t);}
 else if(type==='event'){currentView='calendario';render();const e=dbData.events.find(e=>e.id===id);if(e)eventModal(e);}
 else if(type==='folder'){activeFolderId=id;currentView='folder';render();}
}
function setTheme(theme) {document.documentElement.dataset.theme=theme;safeSetPref('entre-lineas-theme',theme);const el=$('#themeToggle');if(el)el.innerHTML=icon(theme==='dark'?'sun':'moon',17);}
function setSidebarCollapsed(collapsed) {document.documentElement.classList.toggle('sidebar-collapsed',collapsed);safeSetPref('entre-lineas-sidebar',collapsed?'collapsed':'expanded');}
async function goView(view) {if(currentView==='editor'){await saveEditor(true);}activeFolderId=null;currentView=view;render();content.focus({preventScroll:true});}
function startReminderLoop() {
 clearInterval(reminderTimer);
 reminderTimer=setInterval(async()=>{
  const now=Date.now();
  for(const reminder of [...dbData.reminders]){
   if(reminder.state!=='pending')continue;
   const event=dbData.events.find(e=>e.id===reminder.sourceId&&!e.deletedAt);
   if(!event){reminder.state='cancelled';reminder.updatedAt=nowISO();await putOne('reminders',reminder);continue;}
   const trigger=new Date(reminder.triggerAt).getTime();const start=new Date(event.startAt).getTime();
   if(!Number.isFinite(trigger)||!Number.isFinite(start))continue;
   if(now>start+10*60000){reminder.state='missed';reminder.updatedAt=nowISO();await putOne('reminders',reminder);continue;}
   if(now>=trigger&&now<=start+10*60000){
    reminder.state='sent';reminder.remindedAt=nowISO();reminder.updatedAt=nowISO();await putOne('reminders',reminder);
    const index=dbData.reminders.findIndex(r=>r.id===reminder.id);if(index>=0)dbData.reminders[index]=reminder;
    event.remindedAt=reminder.remindedAt;await putOne('events',event);
    toast(`Recordatorio: ${event.title}`,'warning');
    if('Notification'in window&&Notification.permission==='granted')try{new Notification('Entre Líneas',{body:event.title,icon:'./icon.svg',tag:`event-${event.id}`});}catch{}
   }
  }
 },20000);
}
async function init() {
 setTheme(safeGetPref('entre-lineas-theme')==='dark'?'dark':'light');setSidebarCollapsed(safeGetPref('entre-lineas-sidebar')==='collapsed');
 try { const savedView=safeGetPref('entre-lineas-last-view');if(PREF_VIEWS.has(savedView))currentView=savedView;await openDB();await loadAll();lastStorageEstimate=await estimateStorage();render();startReminderLoop();
  const persist=await requestPersistence(); if(persist.supported&&!persist.persisted)setStorageStatus('Almacenamiento local · copia recomendada');
 } catch(err) { content.innerHTML=`<div class="empty-state"><div class="empty-symbol">${icon('circle-alert',23)}</div><h3>No se pudo abrir el almacenamiento</h3><p>${esc(err.message||'El navegador no permitió abrir IndexedDB.')}</p><p>Abre la aplicación mediante un servidor local o HTTPS. Evita abrir el archivo directamente como file://.</p></div>`;setStorageStatus('Almacenamiento no disponible','error'); }
 updateIconElements();
}

// Global event delegation keeps the app modular and the UI controls consistent.
document.addEventListener('click',async e=>{
 const viewBtn=e.target.closest('[data-view]');if(viewBtn){goView(viewBtn.dataset.view);if(innerWidth<=800)document.documentElement.classList.remove('mobile-menu-open');return;}
 const folderBtn=e.target.closest('[data-folder]');if(folderBtn){if(currentView==='editor')await saveEditor(true);activeFolderId=folderBtn.dataset.folder;currentView='folder';render();return;}
 const action=e.target.closest('[data-action]');if(action){const a=action.dataset.action;
  if(a==='new-note')await createNote();
  else if(a==='quick-capture')showQuickCapture();else if(a==='import-texts')$('#textImportFiles')?.click();
  else if(a==='new-diary')await createDiary();
  else if(a==='new-task')taskModal();
  else if(a==='new-event')eventModal();
  else if(a==='new-collection')collectionModal();
  else if(a==='collection-add-item')collectionItemModal(action.dataset.id);
  else if(a==='collection-rename')collectionModal(dbData.collections.find(c=>c.id===action.dataset.id));
  else if(a==='view-notas')goView('notas');else if(a==='view-inbox')goView('inbox');else if(a==='view-tareas')goView('tareas');else if(a==='view-calendario')goView('calendario');else if(a==='view-colecciones')goView('colecciones');
  else if(a==='back-from-editor'){await saveEditor(true);currentView=editorReturnView||'notas';render();}
  else if(a==='editor-favorite')await toggleFavorite();
  else if(a==='export-md')exportNote('md');else if(a==='export-txt')exportNote('txt');else if(a==='versions')await showVersions();else if(a==='editor-more')await showEditorMore();
  else if(a==='empty-trash')confirmEmptyTrash();
  return;
 }
 const opener=e.target.closest('[data-open-item]');if(opener){if(currentView==='papelera'){await handleDeleteOrRestore(opener.dataset.openItem,'papelera');return;}await openItem(opener.dataset.openItem,opener.dataset.itemType);return;}
 const taskEdit=e.target.closest('[data-edit-task]');if(taskEdit){const task=dbData.tasks.find(t=>t.id===taskEdit.dataset.editTask);if(task)taskModal(task);return;}
 const taskDelete=e.target.closest('[data-delete-task]');if(taskDelete){const task=dbData.tasks.find(t=>t.id===taskDelete.dataset.deleteTask);if(task&&confirm(`¿Eliminar la tarea «${task.title}»?`)){await deleteOne('tasks',task.id);dbData.tasks=dbData.tasks.filter(t=>t.id!==task.id);render();toast('Tarea eliminada.');}return;}
 const eventOpen=e.target.closest('[data-open-event]');if(eventOpen){const event=dbData.events.find(x=>x.id===eventOpen.dataset.openEvent);if(event)eventModal(event);return;}
 const collectionOpen=e.target.closest('[data-open-collection]');if(collectionOpen){renderCollectionDetail(collectionOpen.dataset.openCollection);return;}
 const delItem=e.target.closest('[data-delete-collection-item]');if(delItem){const c=dbData.collections.find(x=>x.id===delItem.dataset.collectionId);if(c&&confirm('¿Eliminar este elemento de la colección?')){c.items=(c.items||[]).filter(i=>i.id!==delItem.dataset.deleteCollectionItem);c.updatedAt=nowISO();await putOne('collections',c);renderCollectionDetail(c.id);toast('Elemento eliminado.');}return;}
 const searchResult=e.target.closest('[data-search-result]');if(searchResult){await openSearchResult(searchResult.dataset.resultId,searchResult.dataset.resultType);return;}
 const fmt=e.target.closest('[data-format]');if(fmt){formatSelection(fmt.dataset.format);return;}
 const settingsTab=e.target.closest('[data-settings-tab]');if(settingsTab){activeSettingsTab=settingsTab.dataset.settingsTab;renderSettings();return;}
 const versionPreview=e.target.closest('[data-preview-version]');if(versionPreview){const v=dbData.versions.find(v=>v.id===versionPreview.dataset.previewVersion);if(v){showModal(`Versión · ${esc(v.title||'Sin título')}`,dateLabel(v.savedAt,{year:true,time:true}),`<div class="version-preview">${esc(v.content||'')}</div><div class="modal-actions"><button class="button-secondary" data-modal-close>Cerrar</button><button class="button" data-restore-version="${esc(v.id)}">Restaurar esta versión</button></div>`);}return;}
 const restoreVersion=e.target.closest('[data-restore-version]');if(restoreVersion){const v=dbData.versions.find(v=>v.id===restoreVersion.dataset.restoreVersion);if(v){const note=dbData.notes.find(n=>n.id===v.noteId);if(note){const safeguardVersion={id:uid(),noteId:note.id,title:note.title||'',content:note.content||'',savedAt:nowISO(),reason:'Antes de restaurar otra versión'};await putOne('versions',safeguardVersion);dbData.versions.push(safeguardVersion);note.title=v.title;note.content=v.content;note.updatedAt=nowISO();await putOne('notes',note);dbData.notes=dbData.notes.map(n=>n.id===note.id?note:n);closeModal();currentView='editor';currentNoteId=note.id;currentEditorType='note';render();toast('Versión restaurada como estado actual; el historial se conservó.');}}return;}
 const shift=e.target.closest('[data-calendar-shift]');if(shift){calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+Number(shift.dataset.calendarShift),1);renderCalendar();updateIconElements(content);return;}
 if(e.target.closest('[data-calendar-today]')){calendarCursor=new Date();renderCalendar();updateIconElements(content);return;}
 const dayCell=e.target.closest('[data-calendar-date]');if(dayCell&&!e.target.closest('[data-open-event]')){eventModal(null,dayCell.dataset.calendarDate);return;}
 if(e.target.closest('[data-modal-close]')){closeModal();return;}
 if(e.target.closest('[data-open-item]'))return;
 });

document.addEventListener('change',async e=>{
 const taskToggle=e.target.closest('[data-toggle-task]');if(taskToggle){const t=dbData.tasks.find(t=>t.id===taskToggle.dataset.toggleTask);if(!t)return;t.done=taskToggle.checked;t.updatedAt=nowISO();await putOne('tasks',t);render();return;}
 const dark=e.target.closest('#darkThemeCheck');if(dark){setTheme(dark.checked?'dark':'light');return;}
});
$('#newNoteBtn').addEventListener('click',()=>createNote());$('#quickCaptureBtn').addEventListener('click',showQuickCapture);$('#addFolderBtn').addEventListener('click',showFolderModal);
$('#collapseSidebar').addEventListener('click',()=>setSidebarCollapsed(!document.documentElement.classList.contains('sidebar-collapsed')));
$('#mobileMenuBtn').addEventListener('click',()=>document.documentElement.classList.toggle('mobile-menu-open'));
$('#searchTrigger').addEventListener('click',openSearch);$('#profileButton').addEventListener('click',()=>goView('configuracion'));
$('#themeToggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
searchInput.addEventListener('input',renderSearchResults);
searchInput.addEventListener('keydown',async e=>{const list=$$('.search-result',searchResults);if(e.key==='Escape'){closeSearch();return;}if(e.key==='ArrowDown'){e.preventDefault();searchActiveIndex=Math.min(searchActiveIndex+1,list.length-1);list.forEach((n,i)=>n.classList.toggle('selected',i===searchActiveIndex));list[searchActiveIndex]?.scrollIntoView({block:'nearest'});}if(e.key==='ArrowUp'){e.preventDefault();searchActiveIndex=Math.max(0,searchActiveIndex-1);list.forEach((n,i)=>n.classList.toggle('selected',i===searchActiveIndex));}if(e.key==='Enter'&&list.length){e.preventDefault();const row=list[Math.max(0,searchActiveIndex)];if(row)await openSearchResult(row.dataset.resultId,row.dataset.resultType);}});
searchOverlay.addEventListener('click',e=>{if(e.target===searchOverlay)closeSearch();});modalBackdrop.addEventListener('click',e=>{if(e.target===modalBackdrop)closeModal();});
document.addEventListener('keydown',async e=>{
 if(e.key==='Escape'){if(!searchOverlay.hidden){closeSearch();return;}if(!modalBackdrop.hidden){closeModal();return;}if(document.documentElement.classList.contains('mobile-menu-open'))document.documentElement.classList.remove('mobile-menu-open');}
 const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();if(searchOverlay.hidden)openSearch();else closeSearch();return;}
 if(mod&&e.key.toLowerCase()==='s'&&currentView==='editor'){e.preventDefault();await saveEditor(true);toast('Se solicitó guardar la nota.');return;}
 if(!mod&&!e.altKey&&!e.shiftKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){if(e.key.toLowerCase()==='n'){e.preventDefault();createNote();}else if(e.key.toLowerCase()==='q'){e.preventDefault();showQuickCapture();}}
});
window.addEventListener('beforeunload',e=>{if(currentView==='editor'&&editorDirty){saveEditor(true);e.preventDefault();e.returnValue='';}});
window.addEventListener('online',()=>setStorageStatus('Almacenamiento local activo'));
window.addEventListener('offline',()=>setStorageStatus('Sin conexión · los datos locales siguen disponibles','warning'));
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')) {
 window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
init();
