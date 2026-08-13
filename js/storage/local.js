/**
 * `local` backend — IndexedDB on this device only.
 *
 * Nothing leaves the browser. Intended for evaluation, demos, and offline work
 * before a detachment has stood up their Google account. Every adapter exposes
 * the same surface, so a org can be migrated to Drive later by exporting a
 * bundle from Settings and importing it once connected.
 */

import { idb, STORE_DOCS } from './idb.js';

export const localAdapter = {
  id: 'local',
  label: 'This device only',
  /** Doc paths are stored flat and keyed by their full path. */
  isAvailable: () => 'indexedDB' in window,

  async connect() {
    await idb.all(STORE_DOCS); // forces the upgrade/open to run and surface errors
    return { ok: true, detail: 'Local browser storage' };
  },

  async ensureLayout() {
    // Flat key/value store — folders are implied by the path prefix.
    return true;
  },

  async readDoc(path) {
    const row = await idb.get(STORE_DOCS, path);
    return row ? row.data : null;
  },

  async writeDoc(path, data) {
    await idb.put(STORE_DOCS, { path, data, updatedAt: new Date().toISOString() });
    return data;
  },

  async deleteDoc(path) {
    await idb.delete(STORE_DOCS, path);
    return true;
  },

  /** Lists documents directly under `folderPath` (not recursively). */
  async list(folderPath) {
    const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
    const rows = await idb.all(STORE_DOCS);
    return rows
      .filter((row) => row.path.startsWith(prefix) && !row.path.slice(prefix.length).includes('/'))
      .map((row) => ({
        name: row.path.slice(prefix.length),
        path: row.path,
        modifiedAt: row.updatedAt,
      }));
  },

  /** Lists every document under `folderPath`, at any depth. */
  async listDeep(folderPath) {
    const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
    const rows = await idb.all(STORE_DOCS);
    return rows
      .filter((row) => row.path.startsWith(prefix))
      .map((row) => ({ name: row.path.slice(prefix.length), path: row.path, modifiedAt: row.updatedAt }));
  },

  async status() {
    const rows = await idb.all(STORE_DOCS);
    let quota = null;
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quota = { usage: est.usage, quota: est.quota };
    }
    return { status: 'ready', detail: `${rows.length} documents on this device`, quota };
  },

  async wipe() {
    await idb.clear(STORE_DOCS);
    return true;
  },
};
