import { useState, useEffect, useCallback } from "react";
import { getUIDs, updateUIDs, deleteUID, appendUIDs, toggleSaved, clearAllUIDs, type UIDEntry } from "@/lib/storage";
import { fetchFBProfiles } from "@/lib/api";

const CHUNK_SIZE = 12;
const RETRY_DELAY_MS = 1300;
const queued: UIDEntry[] = [];
const queuedIds = new Set<string>();
let processing: Promise<void> | null = null;

function emitActivity(): void {
  window.dispatchEvent(new Event("uids-fetch-state"));
}

export function getFetchActivity(): number {
  return queuedIds.size;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSafePicture(value: string | null | undefined): value is string {
  return typeof value === "string" &&
    /^https:\/\//i.test(value) &&
    !/\/fb-api\/proxy\/pic\//.test(value);
}

async function runQueue(): Promise<void> {
  while (queued.length) {
    const chunk = queued.splice(0, CHUNK_SIZE);
    updateUIDs(chunk.map(item => ({ id: item.id, status: "pending" as const, paused: false })));
    let response: Awaited<ReturnType<typeof fetchFBProfiles>> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchFBProfiles(chunk.map(item => ({ uid: item.uid })));
        break;
      } catch (error) {
        console.warn("UID Operator fetch chunk failed", error);
        if (attempt === 0) await sleep(RETRY_DELAY_MS);
      }
    }

    const byUID = new Map(response?.results.map(item => [item.uid, item.result]) || []);
    const now = new Date().toISOString();
    const updates = chunk.map(item => {
      const profile = byUID.get(item.uid);
      if (!profile) return { id: item.id, status: "error" as const, fetchedAt: now };
      const picture = isSafePicture(profile.profile_pic) ? profile.profile_pic : undefined;
      const success = profile.status === "success" && Boolean(profile.name || picture);
      return {
        id: item.id,
        status: (success ? "success" : "error") as "success" | "error",
        name: profile.name || item.name,
        username: profile.username || item.username,
        profilePic: picture || (isSafePicture(item.profilePic) ? item.profilePic : undefined),
        followerCount: typeof profile.follower_count === "number" ? profile.follower_count : item.followerCount,
        hasInstagram: Boolean(profile.has_instagram),
        fetchedAt: now,
      };
    });

    try {
      updateUIDs(updates);
    } finally {
      for (const item of chunk) queuedIds.delete(item.id);
      emitActivity();
    }
    // Keep request concurrency bounded; avoid saturating the mobile browser and server.
    if (queued.length) await sleep(350);
  }
}

function enqueueFetch(items: UIDEntry[]): Promise<void> {
  for (const item of items) {
    if (!/^\d{5,25}$/.test(item.uid) || queuedIds.has(item.id)) continue;
    queuedIds.add(item.id);
    queued.push(item);
  }
  emitActivity();
  if (!processing && queued.length) {
    processing = runQueue().finally(() => {
      processing = null;
      emitActivity();
      if (queued.length) void enqueueFetch([]);
    });
  }
  return processing || Promise.resolve();
}

export function useUIDs() {
  const [uids, setUids] = useState<UIDEntry[]>(getUIDs());

  useEffect(() => {
    const refresh = () => setUids(getUIDs());
    window.addEventListener("uids-updated", refresh);
    return () => window.removeEventListener("uids-updated", refresh);
  }, []);

  const batchFetch = useCallback((items: UIDEntry[]) => enqueueFetch(items), []);

  return {
    uids,
    batchFetch,
    deleteUID,
    appendUIDs,
    toggleSaved,
    clearAllUIDs,
  };
}
