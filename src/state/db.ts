/** IndexedDB persistence: projects, original audio blobs and cached analysis features. */
import type { Features } from '../engine/types';
import type { Project } from './project';
import type { TeachTake } from './teach';

const DB_NAME = 'chordlab';
const VERSION = 2;
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB is unavailable, so projects can’t be saved in this browser.')); return; }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('features')) db.createObjectStore('features');
      if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database.'));
    req.onblocked = () => reject(new Error('Close other Chordlab tabs to finish updating the local database.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? req.error);
    t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted — the device may be out of space.'));
  }));
}

export const db = {
  listProjects: () => tx<Project[]>('projects', 'readonly', (s) => s.getAll() as IDBRequest<Project[]>),
  getProject: (id: string) => tx<Project | undefined>('projects', 'readonly', (s) => s.get(id)),
  putProject: (p: Project) => tx('projects', 'readwrite', (s) => s.put(p)),
  getAudio: (id: string) => tx<Blob | undefined>('audio', 'readonly', (s) => s.get(id)),
  putAudio: (id: string, blob: Blob) => tx('audio', 'readwrite', (s) => s.put(blob, id)),
  getFeatures: (id: string) => tx<Features | undefined>('features', 'readonly', (s) => s.get(id)),
  putFeatures: (id: string, f: Features) => tx('features', 'readwrite', (s) => s.put(f, id)),
  listTakes: () => tx<TeachTake[]>('takes', 'readonly', (s) => s.getAll() as IDBRequest<TeachTake[]>),
  putTake: (t: TeachTake) => tx('takes', 'readwrite', (s) => s.put(t)),
  deleteTake: (id: string) => tx('takes', 'readwrite', (s) => s.delete(id)),
  clearTakes: () => tx('takes', 'readwrite', (s) => s.clear()),
  async deleteProject(id: string) {
    await tx('projects', 'readwrite', (s) => s.delete(id));
    await tx('audio', 'readwrite', (s) => s.delete(id));
    await tx('features', 'readwrite', (s) => s.delete(id));
  },
};

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage, quota, persisted };
}

export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
