// Tiny IndexedDB resume store for the transcription engine. Keyed by movie
// id so a cancelled or crashed scan picks up at the next 5-minute segment
// instead of re-listening from frame one.

import type { SubtitleCue } from "../subtitles";

export type ScanCheckpoint = {
  movieId: string;
  nextStart: number;
  cues: SubtitleCue[];
  language: string | null;
  total: number;
  updatedAt: number;
};

const DB_NAME = "ruxx-scan";
const STORE = "checkpoints";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "movieId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function loadCheckpoint(movieId: string): Promise<ScanCheckpoint | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(movieId);
      request.onsuccess = () => resolve((request.result as ScanCheckpoint | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}

export async function saveCheckpoint(checkpoint: ScanCheckpoint): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(checkpoint);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    } finally {
      db.close();
    }
  });
}

export async function clearCheckpoint(movieId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(movieId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    } finally {
      db.close();
    }
  });
}
