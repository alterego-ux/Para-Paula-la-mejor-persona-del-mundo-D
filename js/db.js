const pathScope = location.pathname.split('/').filter(Boolean)[0] || 'root';
const DB_NAME = `entre-lineas-local-${pathScope.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
const DB_VERSION = 2;
export const STORES = ['notes', 'folders', 'tags', 'diary', 'tasks', 'events', 'reminders', 'attachments', 'collections', 'versions', 'metadata'];

let dbPromise;
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Este navegador no ofrece IndexedDB. Exporta tus datos si necesitas conservarlos.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
      const notes = request.transaction.objectStore('notes');
      if (!notes.indexNames.contains('updatedAt')) notes.createIndex('updatedAt', 'updatedAt', { unique: false });
      if (!notes.indexNames.contains('folderId')) notes.createIndex('folderId', 'folderId', { unique: false });
      const tasks = request.transaction.objectStore('tasks');
      if (!tasks.indexNames.contains('dueAt')) tasks.createIndex('dueAt', 'dueAt', { unique: false });
      const events = request.transaction.objectStore('events');
      if (!events.indexNames.contains('startAt')) events.createIndex('startAt', 'startAt', { unique: false });
      const reminders = request.transaction.objectStore('reminders');
      if (!reminders.indexNames.contains('triggerAt')) reminders.createIndex('triggerAt', 'triggerAt', { unique: false });
      const attachments = request.transaction.objectStore('attachments');
      if (!attachments.indexNames.contains('noteId')) attachments.createIndex('noteId', 'noteId', { unique: false });
      const versions = request.transaction.objectStore('versions');
      if (!versions.indexNames.contains('noteId')) versions.createIndex('noteId', 'noteId', { unique: false });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error || new Error('No se pudo abrir la base local.')); };
    request.onblocked = () => reject(new Error('Cierra otras pestañas de Entre Líneas y vuelve a intentarlo.'));
  });
  return dbPromise;
}

export async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('No se pudieron leer los datos.'));
  });
}
export async function getOne(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('No se pudo leer el elemento.'));
  });
}
export async function putOne(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error('No se pudo guardar. Puede que el almacenamiento esté lleno.'));
    tx.onabort = () => reject(tx.error || new Error('El guardado fue cancelado.'));
  });
}
export async function deleteOne(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('No se pudo eliminar.'));
  });
}
export async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error || new Error('No se pudo vaciar el almacenamiento.'));
  });
}
export async function putMany(storeName, records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const record of records) store.put(record);
    tx.oncomplete = () => resolve(records.length);
    tx.onerror = () => reject(tx.error || new Error('No se pudieron restaurar todos los datos.'));
    tx.onabort = () => reject(tx.error || new Error('La restauración fue cancelada.'));
  });
}
export async function replaceAll(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const stores = STORES.filter(s => Array.isArray(data[s]));
    const tx = db.transaction(stores, 'readwrite');
    for (const name of stores) {
      const store = tx.objectStore(name); store.clear();
      for (const item of data[name]) store.put(item);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('No se pudo restaurar la copia.'));
    tx.onabort = () => reject(tx.error || new Error('La restauración fue cancelada.'));
  });
}
export async function estimateStorage() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  try { return { supported: true, persisted: await navigator.storage.persist() }; }
  catch { return { supported: true, persisted: false }; }
}
