/**
 * Minimal IndexedDB wrapper. Backs the `local` storage adapter and also holds
 * FileSystemDirectoryHandles for the `folder` adapter (handles are structured-
 * cloneable but cannot go in localStorage).
 */

const DB_NAME = 'nine31';
const DB_VERSION = 2;
export const STORE_DOCS = 'docs';       // path -> { path, data, updatedAt }
export const STORE_HANDLES = 'handles'; // key  -> FileSystemDirectoryHandle
export const STORE_QUEUE = 'queue';     // id   -> pending write, replayed when online

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = fn(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  put: (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
  delete: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  keys: (store) => tx(store, 'readonly', (s) => s.getAllKeys()),
};
