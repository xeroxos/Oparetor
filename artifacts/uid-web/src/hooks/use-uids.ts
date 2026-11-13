import { useState, useEffect, useCallback } from "react";
import { getUIDs, updateUIDs, deleteUID, appendUIDs, toggleSaved, clearAllUIDs, type UIDEntry } from "@/lib/storage";
import { fetchFBProfiles, type FBProfileResult } from "@/lib/api";

// A single bounded fetch queue serves Import, Retry and individual cards.
// Do not put users into a global "paused" mode after login/HTTP errors.
const CHUNK_SIZE = 6;
const BETWEEN_BATCHES_MS = 1100;
const RETRY_DELAY_MS = 1700;
export const MAX_MANUAL_FETCH = 24;

const queued: UIDEntry[] = [];
const queuedIds = new Set<string>();
let processing: Promise<void> | null = null;

function emitActivity(): void {
  window.dispatchEvent(new Event("uids-fetch-state"));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSafePicture(value: string | null | undefined): value is string {
  return typeof value === "string" &&
    /^https:\/\//i.test(value) &&
    !/\/fb-api\/proxy\/pic\//.test(value);
}

export function getFetchActivity(): number {
  return queuedIds.size;
}

function profileUpdate(item: UIDEntry, profile: FBProfileResult | undefined, now: string) {
  if (!profile) {
    return {
      id: item.id, status: "error" as const, paused: false,
      fetchError: "unavailable", fetchedAt: now,
    };
  }
  const picture = isSafePicture(profile.profile_pic) ? profile.profile_pic : undefined;
  const success = profile.status === "success" && Boolean(profile.name || picture);
  if (!success) {
    return {
      id: item.id, status: "error" as const, paused: false,
      fetchError: profile.error || "unavailable", fetchedAt: now,
    };
  }
  return {
    id: item.id, status: "success" as const, paused: false, fetchError: undefined,
    name: profile.name || item.name,
    username: profile.username || item.username,
    profilePic: picture || (isSafePicture(item.profilePic) ? item.profilePic : undefined),
    followerCount: typeof profile.follower_count === "number" ? profile.follower_count : item.followerCount,
    hasInstagram: Boolean(profile.has_instagram),
    fetchedAt: now,
  };
}

async function runQueue(): Promise<void> {
  while (queued.length > 0) {
    const chunk = queued.splice(0, CHUNK_SIZE);
    try {
      updateUIDs(chunk.map(item => ({
        id: item.id, status: "pending" as const, paused: false, fetchError: undefined,
      })));

      let response: Awaited<ReturnType<typeof fetchFBProfiles>> | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetchFBProfiles(chunk.map(item => ({ uid: item.uid })));
          break;
        } catch (error) {
          lastError = error;
          if (attempt === 0) await sleep(RETRY_DELAY_MS);
        }
      }
      if (!response && lastError) console.warn("UID Operator batch request failed", lastError);

      const byUID = new Map(response?.results.map(item => [item.uid, item.result]) || []);
      const now = new Date().toISOString();
      updateUIDs(chunk.map(item => profileUpdate(item, byUID.get(item.uid), now)));
    } catch (error) {
      // Do not discard this chunk if the worker hits a local error.
      console.error("UID Operator fetch chunk error", error);
      const now = new Date().toISOString();
      updateUIDs(chunk.map(item => ({
        id: item.id, status: "error" as const, paused: false,
        fetchError: "network_error", fetchedAt: now,
      })));
    } finally {
      for (const item of chunk) queuedIds.delete(item.id);
      emitActivity();
    }

    if (queued.length > 0) await sleep(BETWEEN_BATCHES_MS);
  }
}

function enqueueFetch(items: UIDEntry[]): Promise<void> {
  for (const item of items) {
    if (!/^\d{5,25}$/.test(item.uid) || queuedIds.has(item.id)) continue;
    queuedIds.add(item.id);
    queued.push(item);
  }
  emitActivity();
  if (!processing && queued.length > 0) {
    processing = runQueue().finally(() => {
      processing = null;
      emitActivity();
      if (queued.length > 0) void enqueueFetch([]);
    });
  }
  return processing || Promise.resolve();
}

export function fetchNewUIDs(items: UIDEntry[]): Promise<void> {
  return enqueueFetch(items);
}

export function resumeUIDFetch(items: UIDEntry[]): Promise<void> {
  return enqueueFetch(items.slice(0, MAX_MANUAL_FETCH));
}

export function useUIDs() {
  const [uids, setUids] = useState<UIDEntry[]>(getUIDs());

  useEffect(() => {
    const refresh = () => setUids(getUIDs());
    window.addEventListener("uids-updated", refresh);
    return () => window.removeEventListener("uids-updated", refresh);
  }, []);

  const batchFetch = useCallback((items: UIDEntry[]) => fetchNewUIDs(items), []);
  const manualFetch = useCallback((items: UIDEntry[]) => resumeUIDFetch(items), []);

  return {
    uids,
    batchFetch,
    manualFetch,
    deleteUID,
    appendUIDs,
    toggleSaved,
    clearAllUIDs,
  };
}
