import { Router, type Request, type Response } from "express";
import { load } from "cheerio";
import { fetch as undiciFetch } from "undici";

const router = Router();

// ---------------------------------------------------------------------------
// User-Agents
// ---------------------------------------------------------------------------
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const SAMSUNG_UA =
  "Mozilla/5.0 (Linux; Android 9; SAMSUNG SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/10.1 Chrome/71.0.3578.99 Mobile Safari/537.36";
const FBOT_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

const IPHONE_HEADERS = {
  "User-Agent": IPHONE_UA,
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const SAMSUNG_HEADERS = {
  "User-Agent": SAMSUNG_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
function parseCookies(cookieStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieStr) return result;
  for (const pair of cookieStr.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) result[k] = v;
  }
  return result;
}

function getDefaultCookies(): Record<string, string> {
  return parseCookies(process.env.FB_DEFAULT_COOKIE ?? "");
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ---------------------------------------------------------------------------
// In-memory CDN cache (2-hour TTL)
// ---------------------------------------------------------------------------
interface CacheEntry {
  url: string;
  ts: number;
}
const cdnCache = new Map<string, CacheEntry>();
const CDN_TTL_MS = 2 * 60 * 60 * 1000;

function cacheSet(uid: string, url: string) {
  cdnCache.set(uid, { url, ts: Date.now() });
}

function cacheGet(uid: string): string | null {
  const entry = cdnCache.get(uid);
  if (!entry) return null;
  if (Date.now() - entry.ts > CDN_TTL_MS) {
    cdnCache.delete(uid);
    return null;
  }
  return entry.url;
}

// ---------------------------------------------------------------------------
// Fetch helpers with timeout + redirect following
// ---------------------------------------------------------------------------
async function fetchHtml(
  url: string,
  headers: Record<string, string>,
  cookies?: Record<string, string>,
  timeoutMs = 12000
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const reqHeaders: Record<string, string> = { ...headers };
    if (cookies && Object.keys(cookies).length > 0) {
      reqHeaders["Cookie"] = cookieHeader(cookies);
    }
    const res = await undiciFetch(url, {
      headers: reqHeaders,
      redirect: "follow",
      signal: controller.signal,
    } as Parameters<typeof undiciFetch>[1]);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// getPublicInfo — iPhone UA on m.facebook.com
// Returns name, username, profile_pic (CDN URL)
// ---------------------------------------------------------------------------
const BAD_TITLES = new Set([
  "facebook",
  "error",
  "log in to facebook",
  "log in",
  "log into facebook",
  "login",
  "sign up",
  "create an account",
  "",
]);
const BAD_SLUGS = new Set([
  "profile.php",
  "home.php",
  "login",
  "sharer",
  "",
]);

interface PublicInfo {
  name?: string;
  username?: string;
  profile_pic?: string;
  follower_count?: number;
}

function parseCount(text: string): number | undefined {
  // e.g. "1,611 likes" / "4,004 likes" / "2.5K followers"
  const m = text.match(/([\d,\.]+)\s*[KMBkmb]?\s*(?:likes?|followers?|people follow)/i);
  if (!m) return undefined;
  let raw = m[1].replace(/,/g, "");
  const suffix = text.slice(m.index! + m[1].length).trim()[0]?.toLowerCase();
  let n = parseFloat(raw);
  if (suffix === "k") n *= 1_000;
  else if (suffix === "m") n *= 1_000_000;
  return isNaN(n) ? undefined : Math.round(n);
}

async function getPublicInfo(uid: string): Promise<PublicInfo> {
  const html = await fetchHtml(
    `https://m.facebook.com/profile.php?id=${uid}`,
    IPHONE_HEADERS,
    undefined,
    12000
  );
  if (!html) return {};

  const $ = load(html);
  const result: PublicInfo = {};

  // Name from <title>
  const titleText = $("title").first().text().trim();
  const candidate = titleText.replace(/\s*\|\s*Facebook\s*$/i, "").trim();
  if (!BAD_TITLES.has(candidate.toLowerCase()) && candidate.length > 1) {
    result.name = candidate;
  }
  if (!result.name) {
    const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() ?? "";
    if (ogTitle && !BAD_TITLES.has(ogTitle.toLowerCase())) {
      result.name = ogTitle;
    }
  }

  // Profile pic CDN URL from og:image
  const ogImage = $('meta[property="og:image"]').attr("content") ?? "";
  if (ogImage && (ogImage.includes("fbcdn.net") || ogImage.includes("scontent"))) {
    result.profile_pic = ogImage;
    cacheSet(uid, ogImage);
  }

  // Follower/likes count from og:description (no cookie needed!)
  // e.g. "Aibur Rahman. 1,611 likes." or "Mohsin Ahmed Evan. 4,004 likes · 37 talking"
  const ogDesc = $('meta[property="og:description"]').attr("content") ?? "";
  if (ogDesc) {
    const count = parseCount(ogDesc);
    if (count !== undefined) result.follower_count = count;
  }

  // Username from og:url or canonical
  const slugSources = [
    $('meta[property="og:url"]').attr("content") ?? "",
    $('link[rel="canonical"]').attr("href") ?? "",
  ];
  for (const src of slugSources) {
    const m = src.match(/facebook\.com\/([^/?#]+)/);
    if (m && !BAD_SLUGS.has(m[1])) {
      result.username = m[1];
      break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// getFollowersWithCookies — Samsung UA on mbasic.facebook.com
// Returns follower_count, optionally name, profile_pic
// ---------------------------------------------------------------------------
interface MbasicInfo {
  name?: string;
  profile_pic?: string;
  follower_count?: number;
}

async function getFollowersWithCookies(
  uid: string,
  cookies: Record<string, string>
): Promise<MbasicInfo> {
  if (!cookies || Object.keys(cookies).length === 0) return {};

  const html = await fetchHtml(
    `https://mbasic.facebook.com/profile.php?id=${uid}`,
    SAMSUNG_HEADERS,
    cookies,
    15000
  );
  if (!html) return {};

  const $ = load(html);
  const result: MbasicInfo = {};

  // Check session validity
  const titleText = $("title").first().text().trim().toLowerCase();
  if (titleText.includes("log in") || titleText === "error" || titleText === "facebook") {
    return {};
  }

  // Name from title
  const BAD = new Set(["error", "facebook", "log in", "log in to facebook", "log into facebook", ""]);
  const rawTitle = $("title").first().text().trim();
  if (!BAD.has(rawTitle.toLowerCase())) {
    result.name = rawTitle;
  }

  // Profile pic from og:image
  const ogImage = $('meta[property="og:image"]').attr("content") ?? "";
  if (ogImage && ogImage.includes("fbcdn.net")) {
    result.profile_pic = ogImage;
  }

  // Follower count from og:description
  const ogDesc = $('meta[property="og:description"]').attr("content") ?? "";
  const m = ogDesc.match(/([\d,]+)\s*(?:likes|followers)/i);
  if (m) {
    const num = parseInt(m[1].replace(/,/g, ""), 10);
    if (!isNaN(num)) result.follower_count = num;
  }

  return result;
}

// ---------------------------------------------------------------------------
// concurrency pool — run tasks with max N concurrent
// ---------------------------------------------------------------------------
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// fetchUidInfo — parallel A+B+C
// ---------------------------------------------------------------------------
interface UidResult {
  status: "success" | "error";
  name: string | null;
  username: string | null;
  profile_pic: string | null;
  follower_count: number | null;
  has_instagram: boolean;
}

async function fetchUidInfo(
  uid: string,
  cookies: Record<string, string>
): Promise<UidResult> {
  const result: UidResult = {
    status: "error",
    name: null,
    username: null,
    profile_pic: null,
    follower_count: null,
    has_instagram: false,
  };

  const hasCookies = Object.keys(cookies).length > 0;

  const [pub, mbasic] = await Promise.all([
    getPublicInfo(uid),
    hasCookies ? getFollowersWithCookies(uid, cookies) : Promise.resolve({} as MbasicInfo),
  ]);

  result.name = pub.name ?? mbasic.name ?? null;
  result.username = pub.username ?? null;

  const cdnPic = pub.profile_pic ?? mbasic.profile_pic ?? null;
  if (cdnPic) {
    cacheSet(uid, cdnPic);
    result.profile_pic = cdnPic;
  }

  // Prefer mbasic (cookie-based, more accurate), fallback to og:description from m.facebook.com
  const followerCount = mbasic.follower_count ?? pub.follower_count ?? null;
  if (followerCount != null) {
    result.follower_count = followerCount;
  }

  if (result.name || cdnPic) {
    result.status = "success";
  }

  // Instagram: show icon when FB username exists
  // (server-side Instagram check blocked by 429 from Replit IPs)
  result.has_instagram = !!result.username;

  return result;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/", (_req, res) => {
  res.json({
    name: "Facebook Info Extractor",
    version: "5.0",
    runtime: "node",
    endpoints: {
      "POST /fb-api/uid/fetch": "Fetch profile info for a list of UIDs",
      "GET /fb-api/proxy/pic/:uid": "Proxy real profile picture for a UID",
    },
  });
});

router.post("/uid/fetch", async (req: Request, res: Response) => {
  const data = req.body as { uids?: unknown; cookie?: string };
  if (!data?.uids || !Array.isArray(data.uids)) {
    res.status(400).json({ success: false, error: "Missing uids list" });
    return;
  }

  const cookieStr = (data.cookie ?? "") || (process.env.FB_DEFAULT_COOKIE ?? "");
  const cookies = parseCookies(cookieStr);

  const uidList = data.uids as Array<{ uid?: unknown; password?: unknown }>;

  const tasks = uidList.map((item) => async () => {
    const uid = String(item.uid ?? "").trim();
    if (!uid) return null;
    const result = await fetchUidInfo(uid, cookies);
    return { uid, password: item.password, result };
  });

  const results = await withConcurrency(tasks, 12);

  res.json({
    success: true,
    results: results.filter(Boolean),
    total: results.filter(Boolean).length,
    timestamp: new Date().toISOString(),
  });
});

router.post("/uid/check", (req: Request, res: Response) => {
  const uid = (req.body as { uid?: string })?.uid ?? "";
  res.json({
    success: true,
    uid,
    status: "unknown",
    message: "Account check not yet implemented",
    timestamp: new Date().toISOString(),
  });
});

router.get("/proxy/pic/:uid", async (req: Request, res: Response) => {
  const uid = String(req.params.uid);
  let cdnUrl = cacheGet(uid);

  if (!cdnUrl) {
    const info = await getPublicInfo(uid);
    cdnUrl = info.profile_pic ?? null;
  }

  if (!cdnUrl) {
    res.status(404).json({ error: "No picture found" });
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const imgRes = await undiciFetch(cdnUrl, {
      headers: {
        "User-Agent": FBOT_UA,
        Referer: "https://www.facebook.com/",
      },
      signal: controller.signal,
    } as Parameters<typeof undiciFetch>[1]);
    clearTimeout(timer);

    if (!imgRes.ok) {
      cdnCache.delete(uid);
      res.status(502).json({ error: "CDN fetch failed" });
      return;
    }

    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=7200");
    res.set("Access-Control-Allow-Origin", "*");

    const buf = await imgRes.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch {
    res.status(502).json({ error: "Proxy error" });
  }
});

export default router;
