import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Server-side backup of every device's tracked activity (imports & fetches).
 * Each row stores the full `uid|password` entry list along with device info.
 */
export const trackEventsTable = pgTable(
  "track_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    action: text("action").notNull(),
    ip: text("ip").notNull().default("unknown"),
    ua: text("ua").notNull().default("unknown"),
    sessionId: text("session_id").notNull().default("unknown"),
    entries: jsonb("entries").$type<string[]>().notNull(),
  },
  (table) => [index("track_events_timestamp_idx").on(table.timestamp)],
);

export type TrackEventRow = typeof trackEventsTable.$inferSelect;
export type InsertTrackEvent = typeof trackEventsTable.$inferInsert;
