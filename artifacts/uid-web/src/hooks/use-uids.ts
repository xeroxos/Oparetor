import { useState, useEffect, useCallback } from "react";
import { getUIDs, updateUIDs, deleteUID, appendUIDs, toggleSaved, clearAllUIDs, type UIDEntry } from "@/lib/storage";
import { fetchFBProfiles, type FBProfileResult } from "@/lib/api";

// Large imports are processed sequentially, not by issuing 1,500 requests at once.
// Respect upstream login/rate-limit responses instead of retrying past restrictions.
const CHUNK_SIZE = 6;
const BETWEEN_BATCHES_MS = 1100;
export const MAX_MANUAL_FETCH = 24;
const BLOCKING_ERRORS = new Set(["rate_limited", "login_required", "network_error", "source_unavailable"]);
const queued: UIDEntry[] = [];
const queuedIds = new Set<string>();
let processing: Promise<void> | null = null;
let pauseCode: string | null = null;

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

export function getFetchPauseReason(): string | null {
  return pauseCode || getUIDs().find(row =>
    row.paused && row.fetchError && BLOCKING_ERRORS.has(row.fetchError)
  )?.fetchError || null;
}

function markPaused(items: UIDEntry[], code: string): void {
  if (!items.length) return;
  updateUIDs(items.map(item => ({
    id: item.id, status: "pending" as const, paused: true, fetchError: code,
  })));
}

/** Stop the queue at the first systemic login / rate-limit / transport problem. */
function pauseQueue(code: string, items: UIDEntry[]): void {
  pauseCode = code;
  const remaining = queued.splice(0);
  markPaused([...items, ...remaining], code);
  for (const item of [...items, ...remaining]) queuedIds.delete(item.id);
  emitActivity();
}

function profileUpdate(item: UIDEntry, profile: FBProfileResult | undefined, now: string) {
  if (!profile) return { id: item.id, status: "error" as const, paused: false, fetchError: "unavailable", fetchedAt: now };
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
  let consecutiveEmptyBatches = 0;
  try {
    while (queued.length) {
      const chunk = queued.splice(0, CHUNK_SIZE);
      updateUIDs(chunk.map(item => ({
        id: item.id, status: "pending" as const, paused: false, fetchError: undefined,
      })));

      let response: Awaited<ReturnType<typeof fetchFBProfiles>>;
      try {
        response = await fetchFBProfiles(chunk.map(item => ({ uid: item.uid })));
      } catch (error) {
        console.warn("UID Operator: pausing queue after API/transport error", error);
        pauseQueue("network_error", chunk);
        break;
      }

      const byUID = new Map(response.results.map(item => [item.uid, item.result]));
      const profiles = chunk.map(item => byUID.get(item.uid));
      const codes = profiles.map(p => p?.error);
      const successCount = profiles.filter(p => p?.status === "success" && (p.name || p.profile_pic)).length;
      const limited = codes.some(code => code === "rate_limited");
      const loginCount = codes.filter(code => code === "login_required").length;
      const networkCount = codes.filter(code => code === "network_error").length;
      const allUnavailable = successCount === 0;

      consecutiveEmptyBatches = allUnavailable ? consecutiveEmptyBatches + 1 : 0;
      // Treat explicit rate limiting as a stop immediately. Majority login walls
      // indicate a systemic authentication issue; isolated private UIDs need not
      // stop the entire list.
      const barrier =
        limited ? "rate_limited" :
        loginCount >= Math.ceil(chunk.length / 2) ? "login_required" :
        networkCount === chunk.length ? "network_error" :
        consecutiveEmptyBatches >= 2 ? "source_unavailable" : null;

      const now = new Date().toISOString();
      if (barrier) {
        // Preserve any successful members of the current chunk.
        const succeeded = chunk.filter(item => {
          const p = byUID.get(item.uid);
          return p?.status === "success" && Boolean(p.name || p.profile_pic);
        });
        if (succeeded.length) {
          updateUIDs(succeeded.map(item => profileUpdate(item, byUID.get(item.uid), now)));
        }
        const affected = chunk.filter(item => !succeeded.some(ok => ok.id === item.id));
        pauseQueue(barrier, affected);
        // Also drop the in-flight successes from the active set.
        for (const item of succeeded) queuedIds.delete(item.id);
        emitActivity();
        break;
      }

      updateUIDs(chunk.map(item => profileUpdate(item, byUID.get(item.uid), now)));
      for (const item of chunk) queuedIds.delete(item.id);
      emitActivity();
      if (queued.length) await sleep(BETWEEN_BATCHES_MS);
    }
  } catch (error) {
    // Never leave thousands of queued records permanently stuck in memory.
    console.error("UID Operator fetch worker failed", error);
    pauseQueue("network_error", queued.splice(0));
  }
}

function enqueueFetch(items: UIDEntry[], userInitiated: boolean): Promise<void> {
  const blocked = getFetchPauseReason();
  if (blocked && !userInitiated) {
    markPaused(items, blocked);
    return Promise.resolve();
  }
  if (userInitiated) pauseCode = null;
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
    });
  }
  return processing || Promise.resolve();
}

/** Import requests are automatic; they must not override a Facebook stop signal. */
export function fetchNewUIDs(items: UIDEntry[]): Promise<void> {
  return enqueueFetch(items, false);
}

/** Called only when the user explicitly resumes after resolving the problem. */
export function resumeUIDFetch(items: UIDEntry[]): Promise<void> {
  return enqueueFetch(items.slice(0, MAX_MANUAL_FETCH), true);
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
