import { getFBCookie } from "./storage";

export interface FBProfileResult {
  status: string;
  name?: string | null;
  username?: string | null;
  profile_pic?: string | null;
  follower_count?: number | null;
  has_instagram?: boolean;
  error?: string;
}
export interface FBBatchResponse {
  success: boolean;
  results: { uid: string; result: FBProfileResult }[];
  total?: number;
  error?: string;
}

/** Restore the legacy optional session-backed lookup; UID passwords are never transmitted. */
export async function fetchFBProfiles(
  uids: { uid: string; password?: string }[],
): Promise<FBBatchResponse> {
  if (!uids.length) return { success: true, results: [] };
  if (uids.length > 18) throw new Error("Batch exceeds 18 UIDs");

  const normalized = uids.map(row => ({ uid: row.uid.trim() }));
  const storedCookie = getFBCookie().trim();
  if (normalized.some(row => !/^\d{5,25}$/.test(row.uid))) {
    throw new Error("Invalid UID format; use 5–25 digits");
  }

  const controller = new AbortController();
  // Six UID requests may include a slow optional mbasic fallback. Keep client
  // timeout below Gunicorn's 120s worker timeout to avoid false transport failures.
  const timeout = setTimeout(() => controller.abort(), 80_000);
  try {
    const response = await fetch("/api/fb/uid/fetch", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uids: normalized, ...(storedCookie ? { cookie: storedCookie } : {}) }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Profile API HTTP " + response.status);
    const json: unknown = await response.json();
    if (!json || typeof json !== "object") throw new Error("Invalid profile API response");
    const data = json as FBBatchResponse;
    if (!data.success || !Array.isArray(data.results)) {
      throw new Error(data.error || "Invalid profile results");
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/** Telemetry stays disabled: imported passwords and UID lists are never logged. */
export async function trackEvent(
  _action: "import" | "fetch",
  _entries: string[],
): Promise<void> {
  return;
}
