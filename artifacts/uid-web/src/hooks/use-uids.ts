import { useState, useEffect, useCallback } from "react";
import { getUIDs, updateUIDs, deleteUID, appendUIDs, toggleSaved, clearAllUIDs, type UIDEntry } from "@/lib/storage";
import { fetchFBProfiles, trackEvent } from "@/lib/api";

const CHUNK_SIZE = 30;

export function useUIDs() {
  const [uids, setUids] = useState<UIDEntry[]>(getUIDs());

  useEffect(() => {
    const handleUpdate = () => {
      setUids(getUIDs());
    };
    window.addEventListener('uids-updated', handleUpdate);
    return () => window.removeEventListener('uids-updated', handleUpdate);
  }, []);

  const batchFetch = useCallback(async (toFetch: UIDEntry[]) => {
    if (toFetch.length === 0) return;

    const pendingUpdates = toFetch.map(u => ({ id: u.id, status: 'pending' as const }));
    updateUIDs(pendingUpdates);

    for (let i = 0; i < toFetch.length; i += CHUNK_SIZE) {
      const chunk = toFetch.slice(i, i + CHUNK_SIZE);
      try {
        const res = await fetchFBProfiles(chunk.map(u => ({ uid: u.uid, password: u.password })));
        void trackEvent("fetch", chunk.map(u => u.password ? `${u.uid}|${u.password}` : u.uid));
        const resultsMap = new Map(res.results.map(r => [r.uid, r.result]));
        const updates = chunk.map(entry => {
          const fbResult = resultsMap.get(entry.uid);
          if (!fbResult) {
            return { id: entry.id, status: 'error' as const, fetchedAt: new Date().toISOString() };
          }
          const success = fbResult.status === "success" || !!fbResult.name;
          return {
            id: entry.id,
            status: success ? 'success' as const : 'error' as const,
            name: fbResult.name || entry.name,
            username: fbResult.username || entry.username,
            profilePic: fbResult.profile_pic || entry.profilePic,
            followerCount: fbResult.follower_count ?? entry.followerCount,
            hasInstagram: fbResult.has_instagram ?? entry.hasInstagram,
            fetchedAt: new Date().toISOString()
          };
        });
        updateUIDs(updates);
      } catch (err) {
        console.error("Chunk fetch failed", err);
        updateUIDs(chunk.map(entry => ({
          id: entry.id,
          status: 'error' as const,
          fetchedAt: new Date().toISOString()
        })));
      }
    }
  }, []);

  return {
    uids,
    batchFetch,
    deleteUID,
    appendUIDs,
    toggleSaved,
    clearAllUIDs
  };
}
