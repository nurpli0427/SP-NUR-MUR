import type {
  CareRecord,
  LocalBackupSnapshot,
  LocalDraftEntry,
  PatientChart,
} from '../types/nursing';

const DB_NAME = 'carenote_rn_vault';
const DB_VERSION = 1;
const STORE_DRAFTS = 'drafts';
const STORE_BACKUPS = 'backups';
const MAX_SNAPSHOTS = 20;

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'draftKey' });
      }
      if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
        db.createObjectStore(STORE_BACKUPS, { keyPath: 'snapshotId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export async function saveLocalDraft(entry: LocalDraftEntry): Promise<void> {
  try {
    const db = await openVault();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readwrite');
      tx.objectStore(STORE_DRAFTS).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Local draft save failed:', err);
  }
}

export async function getAllLocalDrafts(): Promise<LocalDraftEntry[]> {
  try {
    const db = await openVault();
    const list = await new Promise<LocalDraftEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readonly');
      const req = tx.objectStore(STORE_DRAFTS).getAll();
      req.onsuccess = () => resolve((req.result as LocalDraftEntry[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  } catch {
    return [];
  }
}

export async function deleteLocalDraft(draftKey: string): Promise<void> {
  try {
    const db = await openVault();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readwrite');
      tx.objectStore(STORE_DRAFTS).delete(draftKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Local draft delete failed:', err);
  }
}

function serializeForBackup<T>(items: T[]): T[] {
  return JSON.parse(JSON.stringify(items)) as T[];
}

export async function createBackupSnapshot(params: {
  triggerType: 'auto' | 'manual' | 'pre_sign';
  nurseUid: string;
  nurseName: string;
  patients: PatientChart[];
  records: CareRecord[];
}): Promise<LocalBackupSnapshot | null> {
  try {
    const drafts = await getAllLocalDrafts();
    const snapshot: LocalBackupSnapshot = {
      snapshotId: `bak_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAtMs: Date.now(),
      triggerType: params.triggerType,
      nurseUid: params.nurseUid,
      nurseName: params.nurseName,
      patientsCount: params.patients.length,
      recordsCount: params.records.length,
      patients: serializeForBackup(params.patients),
      records: serializeForBackup(params.records),
      drafts: serializeForBackup(drafts),
    };

    const db = await openVault();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BACKUPS, 'readwrite');
      const store = tx.objectStore(STORE_BACKUPS);
      store.put(snapshot);
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const all = ((getAllReq.result as LocalBackupSnapshot[]) || []).sort(
          (a, b) => b.createdAtMs - a.createdAtMs
        );
        if (all.length > MAX_SNAPSHOTS) {
          for (const stale of all.slice(MAX_SNAPSHOTS)) {
            store.delete(stale.snapshotId);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return snapshot;
  } catch (err) {
    console.warn('Auto backup snapshot failed:', err);
    return null;
  }
}

export async function getBackupSnapshots(): Promise<LocalBackupSnapshot[]> {
  try {
    const db = await openVault();
    const list = await new Promise<LocalBackupSnapshot[]>((resolve, reject) => {
      const tx = db.transaction(STORE_BACKUPS, 'readonly');
      const req = tx.objectStore(STORE_BACKUPS).getAll();
      req.onsuccess = () => resolve((req.result as LocalBackupSnapshot[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch {
    return [];
  }
}

export function downloadSnapshotJson(snapshot: LocalBackupSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date(snapshot.createdAtMs);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(
    2,
    '0'
  )}`;
  a.href = url;
  a.download = `CareNoteRN_Backup_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
