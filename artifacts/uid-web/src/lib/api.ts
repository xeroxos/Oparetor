import { getFBCookie } from "./storage";

export async function fetchFBProfiles(uids: { uid: string; password?: string }[]) {
  if (uids.length === 0) return { results: [] };

  const cookie = getFBCookie();

  const res = await fetch("/api/fb/uid/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uids: uids.map(({ uid }) => ({ uid })), ...(cookie ? { cookie } : {}) }),
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

// UID/password imports are private browser data. No password telemetry is sent.
export async function trackEvent(_action: "import" | "fetch", _entries: string[]): Promise<void> {
  return;
}
