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

const DEFAULT_PREFS: AppPreferences = {
  theme: "dark",
  fontSize: "md",
  viewMode: "compact",
  swipeToDelete: false,
  autoRetry: false,
};

export function getFBCookie(): string {
  return localStorage.getItem(COOKIE_KEY) || "";
}

export function saveFBCookie(cookie: string): void {
  localStorage.setItem(COOKIE_KEY, cookie);
}

export function getPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePreferences(prefs: Partial<AppPreferences>): void {
  const current = getPreferences();
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }));
  window.dispatchEvent(new Event("prefs-updated"));
}

export function getUIDs(): UIDEntry[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveUIDs(uids: UIDEntry[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uids));
    window.dispatchEvent(new Event("uids-updated"));
    return true;
  } catch (err) {
    console.error("Failed to save UIDs", err);
    return false;
  }
}

// Append every entry as-is (no dedup/merge) — keep all pasted lines.
// Returns how many were added and whether the save succeeded (false = storage full).
export function appendUIDs(newUIDs: UIDEntry[]): { added: number; saved: boolean } {
  if (newUIDs.length === 0) return { added: 0, saved: true };
  const existing = getUIDs();
  const saved = saveUIDs([...newUIDs, ...existing]);
  return { added: saved ? newUIDs.length : 0, saved };
}

export function updateUIDs(updates: (Partial<UIDEntry> & { id: string })[]): void {
  const existing = getUIDs();
  const updateMap = new Map(updates.map((u) => [u.id, u]));
  const next = existing.map((e) =>
    updateMap.has(e.id) ? { ...e, ...updateMap.get(e.id) } : e
  );
  saveUIDs(next);
}

export function deleteUID(id: string): void {
  saveUIDs(getUIDs().filter((e) => e.id !== id));
}

export function toggleSaved(id: string): void {
  const existing = getUIDs();
  saveUIDs(existing.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e)));
}

export function clearAllUIDs(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("uids-updated"));
}
