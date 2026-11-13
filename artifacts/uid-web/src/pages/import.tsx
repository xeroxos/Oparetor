import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Upload, FileUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUIDs } from "@/hooks/use-uids";
import { useToast } from "@/hooks/use-toast";
import { waitForUIDStorage, flushUIDStorage, type UIDEntry } from "@/lib/storage";

const MAX_IMPORT = 50_000;
const UID_PATTERN = /^\d{5,25}$/;

function makeId(): string {
  return crypto.randomUUID?.() || (Date.now() + "-" + Math.random().toString(36).slice(2));
}

function normalizeRow(row: unknown): UIDEntry | null {
  if (typeof row === "string") {
    const [rawUID, ...rest] = row.trim().split("|");
    const uid = rawUID?.trim() || "";
    if (!UID_PATTERN.test(uid)) return null;
    const password = rest.join("|").trim().slice(0, 512) || undefined;
    return { id: makeId(), uid, password, status: "pending" };
  }
  if (typeof row !== "object" || row === null) return null;
  const item = row as Partial<UIDEntry>;
  const uid = String(item.uid || "").trim();
  if (!UID_PATTERN.test(uid)) return null;
  const validStatus = ["success", "error", "pending"].includes(item.status || "");
  return {
    id: makeId(),
    uid,
    password: typeof item.password === "string" ? item.password.slice(0, 512) : undefined,
    name: typeof item.name === "string" ? item.name.slice(0, 180) : undefined,
    username: typeof item.username === "string" ? item.username.slice(0, 100) : undefined,
    profilePic: typeof item.profilePic === "string" && /^https:\/\//.test(item.profilePic)
      ? item.profilePic : undefined,
    followerCount: typeof item.followerCount === "number" ? item.followerCount : undefined,
    hasInstagram: Boolean(item.hasInstagram),
    saved: Boolean(item.saved),
    fetchedAt: typeof item.fetchedAt === "string" ? item.fetchedAt : undefined,
    status: validStatus ? (item.status as UIDEntry["status"]) : "pending",
    paused: Boolean(item.paused),
  };
}

function parseImport(input: string): { records: UIDEntry[]; rejected: number } {
  const trimmed = input.trim();
  let rawRows: unknown[];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const data: unknown = JSON.parse(trimmed);
    const array = Array.isArray(data) ? data :
      typeof data === "object" && data !== null && Array.isArray((data as { uids?: unknown }).uids)
        ? (data as { uids: unknown[] }).uids : null;
    if (!array) throw new Error("JSON must be an array or { uids: [...] }");
    rawRows = array;
  } else {
    rawRows = trimmed.split(/\r?\n/).filter(line => line.trim());
  }
  if (rawRows.length > MAX_IMPORT) throw new Error("Maximum 50,000 rows per import");
  const records = rawRows.map(normalizeRow).filter((row): row is UIDEntry => !!row);
  return { records, rejected: rawRows.length - records.length };
}

export default function Import() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { appendUIDs, batchFetch } = useUIDs();
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoFetch, setAutoFetch] = useState(true);
  const [filename, setFilename] = useState("");
  const lineCount = useMemo(() => (input.trim() ? input.split(/\r?\n/).length : 0), [input]);

  const loadFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 25 MB.", variant: "destructive" });
      return;
    }
    setInput(await file.text());
    setFilename(file.name);
  };

  const handleImport = async () => {
    if (!input.trim() || isProcessing) return;
    setIsProcessing(true);
    try {
      const { records, rejected } = parseImport(input);
      if (!records.length) throw new Error("No valid numeric UIDs found");
      if (!autoFetch) {
        for (const row of records) if (row.status === "pending") row.paused = true;
      }
      await waitForUIDStorage();
      const { added, saved } = appendUIDs(records);
      if (!saved) throw new Error("Browser storage unavailable/full; no records added.");
      await flushUIDStorage();
      // The global queue persists beyond this page and never sends imported passwords.
      if (autoFetch) void batchFetch(records.filter(row => row.status === "pending"));
      toast({
        title: "Import completed",
        description: added.toLocaleString() + " rows saved" +
          (rejected ? " · " + rejected.toLocaleString() + " invalid skipped" : "") +
          (autoFetch ? " · Public info fetch queued" : ""),
      });
      setInput("");
      setFilename("");
      setLocation("/");
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Invalid input",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col p-4 gap-4 pb-28">
      <div className="flex items-center gap-2">
        <Upload className="w-5 h-5 text-[var(--primary)]" />
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Import UIDs</h2>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-3 text-xs flex items-start gap-3 text-[var(--text-muted)]">
        <Info className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-[var(--text-primary)] mb-1">Formats: UID or UID|Password, one per line.</p>
          <p>JSON backups from Settings also work. Duplicates are kept, existing data is never overwritten.</p>
          <p className="mt-2">Passwords remain in this browser and are not sent to the profile lookup API. Only public metadata can be retrieved.</p>
        </div>
      </div>

      <label className="inline-flex items-center gap-2 px-4 py-3 cursor-pointer rounded-xl border border-card-border bg-card text-[var(--primary)]">
        <FileUp className="w-4 h-4" /> {filename || "Choose .txt or .json backup"}
        <input type="file" accept=".txt,.json,text/plain,application/json" className="sr-only" onChange={e => void loadFile(e.target.files?.[0])} disabled={isProcessing} />
      </label>

      <Textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={"100012345678901|Password\n61501234567890|Password"}
        className="w-full min-h-[280px] font-mono text-sm bg-card border-card-border text-[var(--text-primary)] resize-y focus-visible:ring-[var(--primary)]"
        disabled={isProcessing}
        data-testid="textarea-import"
      />

      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <input type="checkbox" checked={autoFetch} onChange={e => setAutoFetch(e.target.checked)}
          className="w-4 h-4 accent-[var(--primary)]" />
        Fetch public profile details after import
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)] font-mono">{lineCount.toLocaleString()} lines</span>
        <Button onClick={() => void handleImport()} disabled={!input.trim() || isProcessing}
          className="min-w-[130px] bg-[var(--primary)] text-white" data-testid="button-import-submit">
          {isProcessing ? "Saving…" : "Import"}
        </Button>
      </div>
    </div>
  );
}
