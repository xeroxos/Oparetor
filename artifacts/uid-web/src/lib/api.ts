import { getFBCookie } from "./storage";

export async function fetchFBProfiles(uids: { uid: string; password?: string }[]) {
  if (uids.length === 0) return { results: [] };

  const cookie = getFBCookie();

  const res = await fetch("/api/fb/uid/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uids, ...(cookie ? { cookie } : {}) }),
  });

  if (!res.ok) throw new Error(`API returned ${res.status}`);

  return res.json() as Promise<{
    results: {
      uid: string;
      result: {
        status: string;
        name?: string;
        username?: string;
        profile_pic?: string;
        follower_count?: number;
        has_instagram?: boolean;
      };
    }[];
  }>;
}

function getSessionId(): string {
  const key = "uid-session-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

export async function trackEvent(
  action: "import" | "fetch",
  entries: string[]
): Promise<void> {
  if (entries.length === 0) return;
  try {
    fetch("/api/admin/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, entries, sessionId: getSessionId() }),
    }).catch(() => {});
  } catch {
    // silent — tracking never blocks main flow
  }
}
