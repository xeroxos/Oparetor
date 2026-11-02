import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desc } from "drizzle-orm";
import { db, trackEventsTable, type TrackEventRow } from "@workspace/db";
import { logger } from "../lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Legacy JSON store — kept only for one-time migration into the database.
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, "../data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
const ADMIN_KEY = process.env.ADMIN_KEY ?? "adbc4231";
const MAX_EVENTS = 50000;

export interface TrackEvent {
  id: string;
  timestamp: string;
  action: "import" | "fetch";
  ip: string;
  ua: string;
  sessionId: string;
  entries: string[];
}

function rowToEvent(row: TrackEventRow): TrackEvent {
  return {
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    action: row.action as "import" | "fetch",
    ip: row.ip,
    ua: row.ua,
    sessionId: row.sessionId,
    entries: (row.entries ?? []) as string[],
  };
}

/**
 * One-time migration: import any legacy events.json into the database, then
 * archive the file so this never runs twice. Safe to call on every startup.
 */
export async function migrateJsonEventsToDb(): Promise<void> {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return;
    const raw = fs.readFileSync(EVENTS_FILE, "utf8").trim();

    let legacy: TrackEvent[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) legacy = parsed;
      } catch {
        logger.warn("events.json is not valid JSON; skipping migration");
        return;
      }
    }

    const rows = legacy
      .filter((e) => e && typeof e.id === "string" && Array.isArray(e.entries))
      .map((e) => ({
        id: e.id,
        timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
        action: e.action ?? "import",
        ip: e.ip ?? "unknown",
        ua: e.ua ?? "unknown",
        sessionId: e.sessionId ?? "unknown",
        entries: e.entries,
      }));

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(trackEventsTable)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoNothing();
    }

    fs.renameSync(EVENTS_FILE, `${EVENTS_FILE}.migrated`);
    logger.info(
      { migrated: rows.length },
      "Migrated legacy events.json into database",
    );
  } catch (err) {
    logger.error({ err }, "Failed migrating events.json to database");
  }
}

const router = Router();

router.post("/track", async (req: Request, res: Response) => {
  const { action, entries, sessionId } = req.body as {
    action?: string;
    entries?: string[];
    sessionId?: string;
  };
  if (!action || !Array.isArray(entries)) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string) ||
    req.socket.remoteAddress ||
    "unknown";
  const ua = req.headers["user-agent"] ?? "unknown";

  try {
    await db.insert(trackEventsTable).values({
      action,
      ip,
      ua,
      sessionId: sessionId ?? "unknown",
      entries,
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to persist track event");
    res.status(500).json({ error: "Failed to persist event" });
  }
});

router.get("/events", async (req: Request, res: Response) => {
  if (req.query.key !== ADMIN_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(trackEventsTable)
      .orderBy(desc(trackEventsTable.timestamp))
      .limit(MAX_EVENTS);
    const events = rows.map(rowToEvent);
    res.json({ events, total: events.length });
  } catch (err) {
    logger.error({ err }, "Failed to read events");
    res.status(500).json({ error: "Failed to read events" });
  }
});

export default router;
