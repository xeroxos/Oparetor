export interface UIDEntry {
  id: string;
  uid: string;
  password?: string;
  name?: string;
  username?: string;
  profilePic?: string;
  followerCount?: number;
  hasInstagram?: boolean;
  status: "pending" | "success" | "error";
  fetchedAt?: string;
  saved?: boolean;
  reInput?: boolean;
  paused?: boolean;
}

export interface AppPreferences {
  theme: "dark" | "light";
  fontSize: "sm" | "md" | "lg";
  viewMode: "full" | "compact";
  swipeToDelete: boolean;
  autoRetry: boolean;
}

const STORAGE_KEY = "uid-operator-uids";
const COOKIE_KEY = "uid-operator-fb-cookie";
const PREFS_KEY = "uid-operator-prefs";
const DB_NAME = "uid-operator-storage";
const DB_VERSION = 1;
const MAX_LEGACY_MIRROR_BYTES = 1_500_000;

const DEFAULT_PREFS: AppPreferences = {
  theme: "dark",
  fontSize: "md",
  viewMode: "compact",
  swipeToDelete: false,
  autoRetry: false,
};

type Mutation = (rows: UIDEntry[]) => UIDEntry[];
let cache: UIDEntry[] | null = null;
let initialLegacy: UIDEntry[] = [];
let database: IDBDatabase | null = null;
let storageReady = false;
let dbAvailable = false;
let pendingChanges: Mutation[] = [];
let writeQueue: Promise<void> = Promise.resolve();

function notify(): void {
  window.dispatchEvent(new Event("uids-updated"));
}

function readLegacy(): UIDEntry[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is UIDEntry =>
      typeof row === "object" && row !== null &&
      typeof row.uid === "string" && typeof row.id === "string"
    );
  } catch {
    return [];
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function dbRead(db: IDBDatabase): Promise<{ rows: UIDEntry[]; initialized: boolean }> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["records", "meta"], "readonly");
    const rowsReq = transaction.objectStore("records").getAll();
    const metaReq = transaction.objectStore("meta").get("initialized");
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve({
      rows: rowsReq.result as UIDEntry[],
      initialized: Boolean(metaReq.result?.value),
    });
  });
}

function replaceDatabase(db: IDBDatabase, rows: UIDEntry[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["records", "meta"], "readwrite");
    const store = tx.objectStore("records");
    store.clear();
    rows.forEach(row => store.put(row));
    tx.objectStore("meta").put({ key: "initialized", value: true });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function persistDelta(db: IDBDatabase, previous: UIDEntry[], current: UIDEntry[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const previousById = new Map(previous.map(row => [row.id, row]));
    const currentIds = new Set(current.map(row => row.id));
    const tx = db.transaction(["records", "meta"], "readwrite");
    const store = tx.objectStore("records");
    for (const row of current) {
      const before = previousById.get(row.id);
      if (!before || before !== row) store.put(row);
    }
    for (const row of previous) {
      if (!currentIds.has(row.id)) store.delete(row.id);
    }
    tx.objectStore("meta").put({ key: "initialized", value: true });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function mirrorSmallSnapshot(rows: UIDEntry[]): boolean {
  try {
    const encoded = JSON.stringify(rows);
    if (encoded.length > MAX_LEGACY_MIRROR_BYTES) {
      // Keep old localStorage intact as a recovery copy; IndexedDB stores updates.
      return dbAvailable || !storageReady;
    }
    localStorage.setItem(STORAGE_KEY, encoded);
    return true;
  } catch {
    return dbAvailable || !storageReady;
  }
}

async function initializeDatabase(): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("No IndexedDB");
    const db = await openDatabase();
    const stored = await dbRead(db);
    const base = stored.initialized ? stored.rows : initialLegacy;
    const changes = pendingChanges.splice(0);
    let rows = base;
    for (const change of changes) rows = change(rows);
    if (!stored.initialized || changes.length) await replaceDatabase(db, rows);
    // A large legacy migration can take seconds; mutations during it must be replayed,
    // never overwritten when hydration completes.
    while (pendingChanges.length) {
      const lateChanges = pendingChanges.splice(0);
      for (const change of lateChanges) rows = change(rows);
      await replaceDatabase(db, rows);
    }
    database = db;
    dbAvailable = true;
    storageReady = true;
    cache = rows;
    notify();
  } catch (err) {
    // Restricted browsers can disable IndexedDB. Never drop the legacy copy.
    console.warn("UID Operator storage fallback:", err);
    storageReady = true;
    dbAvailable = false;
    database = null;
    pendingChanges = [];
    notify();
  }
}

function init(): void {
  if (cache !== null) return;
  initialLegacy = readLegacy();
  cache = initialLegacy;
  void initializeDatabase();
}

function mutate(operation: Mutation): boolean {
  init();
  const previous = cache || [];
  const next = operation(previous);
  if (!Array.isArray(next)) return false;

  // In browsers without IndexedDB, never pretend a full storage write worked.
  if (storageReady && !dbAvailable && !mirrorSmallSnapshot(next)) return false;

  cache = next;
  if (!storageReady) pendingChanges.push(operation);
  if (storageReady && database) {
    const db = database;
    writeQueue = writeQueue.then(() => persistDelta(db, previous, next)).catch(err => {
      console.error("UID Operator IndexedDB save failed", err);
      window.dispatchEvent(new Event("uids-storage-error"));
    });
  }
  if (!storageReady || dbAvailable) mirrorSmallSnapshot(next);
  notify();
  return true;
}

/** Reads localStorage synchronously for backward compatibility; IndexedDB hydrates in the background. */
export function getUIDs(): UIDEntry[] {
  init();
  return cache || [];
}

export function saveUIDs(uids: UIDEntry[]): boolean {
  return mutate(() => uids);
}

export function appendUIDs(newUIDs: UIDEntry[]): { added: number; saved: boolean } {
  if (!newUIDs.length) return { added: 0, saved: true };
  const saved = mutate(current => [...newUIDs, ...current]);
  return { added: saved ? newUIDs.length : 0, saved };
}

export function updateUIDs(updates: (Partial<UIDEntry> & { id: string })[]): void {
  if (!updates.length) return;
  const byId = new Map(updates.map(value => [value.id, value]));
  mutate(current => current.map(row => {
    const update = byId.get(row.id);
    return update ? { ...row, ...update } : row;
  }));
}

export function deleteUID(id: string): void {
  mutate(current => current.filter(row => row.id !== id));
}

export function toggleSaved(id: string): void {
  mutate(current => current.map(row => row.id === id ? { ...row, saved: !row.saved } : row));
}

export function clearAllUIDs(): void {
  // This is only called after the user's explicit destructive confirmation.
  mutate(() => []);
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage disabled */ }
}

export function getFBCookie(): string {
  try { return localStorage.getItem(COOKIE_KEY) || ""; } catch { return ""; }
}

export function saveFBCookie(cookie: string): void {
  try { localStorage.setItem(COOKIE_KEY, cookie); } catch { /* storage disabled */ }
}

export function getPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function savePreferences(prefs: Partial<AppPreferences>): void {
  const current = getPreferences();
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs })); } catch { /* fallback */ }
  window.dispatchEvent(new Event("prefs-updated"));
}

export async function flushUIDStorage(): Promise<void> {
  await waitForUIDStorage();
  await writeQueue;
}

export async function waitForUIDStorage(): Promise<void> {
  init();
  // Imported records are not allowed to clobber existing IndexedDB data on cold start.
  while (!storageReady) await new Promise(resolve => setTimeout(resolve, 25));
}
