import { useState, useEffect, useCallback } from "react";
import { getUIDs, updateUIDs, deleteUID, appendUIDs, toggleSaved, clearAllUIDs, hasFetchedProfileData, effectiveUIDStatus, type UIDEntry } from "@/lib/storage";
import { fetchFBProfiles, type FBProfileResult } from "@/lib/api";

// A single bounded fetch queue serves Import, Retry and individual cards.
// Do not put users into a global "paused" mode after login/HTTP errors.
const CHUNK_SIZE = 6;
const BETWEEN_BATCHES_MS = 1100;
const RETRY_DELAY_MS = 1700;
const UPSTREAM_ACCESS_ERRORS = new Set(["login_required", "rate_limited"]);
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
    const preserved = hasFetchedProfileData(item);
    return {
      id: item.id, status: preserved ? "success" as const : "pending" as const,
      paused: false, retryQueued: false,
      fetchError: preserved ? undefined : "network_error", fetchedAt: now,
    };
  }
  const picture = isSafePicture(profile.profile_pic) ? profile.profile_pic : undefined;
  const success = profile.status === "success" && Boolean(profile.name || profile.username || picture);
  if (!success) {
    const preserved = hasFetchedProfileData(item);
    const sourceUnavailable = ["login_required", "rate_limited", "network_error"].includes(profile.error || "");
    return {
      id: item.id,
      // An upstream login wall or service failure is NOT a bad UID. Keep it
      // pending; existing verified profile data always stays successful.
      status: preserved ? "success" as const : sourceUnavailable ? "pending" as const : "error" as const,
      paused: false, retryQueued: false,
      fetchError: preserved ? undefined : profile.error || "unavailable", fetchedAt: now,
    };
  }
  return {
    id: item.id, status: "success" as const, paused: false, retryQueued: false, fetchError: undefined,
    name: profile.name || item.name,
    username: profile.username || item.username,
    profilePic: picture || (isSafePicture(item.profilePic) ? item.profilePic : undefined),
    followerCount: typeof profile.follower_count === "number" ? profile.follower_count : item.followerCount,
    hasInstagram: Boolean(profile.has_instagram),
    fetchedAt: now,
  };
}

async function runQueue(): Promise<void> {
  let consecutiveRateLimits = 0;
  while (queued.length > 0) {
    const chunk = queued.splice(0, CHUNK_SIZE);
    let upstreamBlocked = false;
    let upstreamReason = "source_unavailable";
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

      // One extra attempt only for transport failures that the backend reports
      // inside HTTP 200 results. Never re-request login/checkpoint or 429 pages.
      const byUID = new Map(response?.results.map(item => [item.uid, item.result]) || []);
      if (!response) {
        for (const item of chunk) {
          byUID.set(item.uid, { status: "error", error: "network_error" });
        }
      }
      const transient = response
        ? chunk.filter(item => byUID.get(item.uid)?.error === "network_error")
        : [];
      if (transient.length) {
        await sleep(RETRY_DELAY_MS * 2);
        try {
          const retried = await fetchFBProfiles(transient.map(item => ({ uid: item.uid })));
          for (const row of retried.results) byUID.set(row.uid, row.result);
        } catch {
          // Keep prior outcomes: next queued entries must not be lost.
        }
      }
      const profiles = chunk.map(item => byUID.get(item.uid));
      const successes = profiles.filter(profile =>
        profile?.status === "success" &&
        Boolean(profile.name || profile.username || profile.profile_pic)
      ).length;
      // Do not turn thousands of unrelated UIDs red if Facebook responds
      // with login/checkpoint or explicit rate limit for a whole batch.
      const accessBlocked = profiles.filter(
        (profile): profile is FBProfileResult =>
          Boolean(profile && UPSTREAM_ACCESS_ERRORS.has(profile.error || ""))
      );
      upstreamBlocked = successes === 0 && accessBlocked.length >= Math.ceil(chunk.length / 2);
      if (upstreamBlocked) {
        upstreamReason = accessBlocked.some(p => p.error === "rate_limited")
          ? "rate_limited" : "login_required";
      }
      const upstreamLimited = Array.from(byUID.values()).some(p => p.error === "rate_limited");
      consecutiveRateLimits = upstreamLimited ? consecutiveRateLimits + 1 : 0;
      const now = new Date().toISOString();
      updateUIDs(chunk.map(item => upstreamBlocked
        ? {
            id: item.id,
            status: hasFetchedProfileData(item) ? "success" as const : "pending" as const,
            paused: false, retryQueued: false, fetchError: upstreamReason, fetchedAt: now,
          }
        : profileUpdate(item, byUID.get(item.uid), now)
      ));
    } catch (error) {
      // Do not discard this chunk if the worker hits a local error.
      console.error("UID Operator fetch chunk error", error);
      const now = new Date().toISOString();
      updateUIDs(chunk.map(item => ({
        id: item.id,
        status: hasFetchedProfileData(item) ? "success" as const : "pending" as const,
        paused: false, retryQueued: false, fetchError: "network_error", fetchedAt: now,
      })));
    } finally {
      for (const item of chunk) queuedIds.delete(item.id);
      emitActivity();
    }

    if (upstreamBlocked) {
      // No persistent paused flag or warning banner; preserve the unprocessed
      // queue as Pending and allow an explicit retry after provider access
      // recovers. Avoid hammering login/checkpoint pages.
      const untouched = queued.splice(0);
      if (untouched.length) {
        const at = new Date().toISOString();
        updateUIDs(untouched.map(item => ({
          id: item.id,
          status: hasFetchedProfileData(item) ? "success" as const : "pending" as const,
          paused: false,
          retryQueued: false,
          fetchError: upstreamReason,
          fetchedAt: at,
        })));
        for (const item of untouched) queuedIds.delete(item.id);
        emitActivity();
      }
      break;
    }

    // Honor HTTP 429 with increasing cooldown, without a global pause banner.
    if (queued.length > 0) {
      const backoff = consecutiveRateLimits
        ? Math.min(300_000, 30_000 * 2 ** Math.min(4, consecutiveRateLimits - 1))
        : BETWEEN_BATCHES_MS;
      await sleep(backoff);
    }
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

/** Queue all selected Failed UIDs durably; CHUNK_SIZE bounds external requests. */
export function resumeUIDFetch(items: UIDEntry[]): Promise<void> {
  const eligible = items.filter(item => effectiveUIDStatus(item) !== "success" && /^\d{5,25}$/.test(item.uid));
  if (eligible.length) {
    updateUIDs(eligible.map(item => ({ id: item.id, retryQueued: true })));
  }
  return enqueueFetch(eligible);
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
