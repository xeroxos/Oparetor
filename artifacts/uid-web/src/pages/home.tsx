import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Plus, Users, MoreHorizontal, RotateCw, Eye, EyeOff, ChevronLeft, ChevronRight, Hash } from "lucide-react";
import { useUIDs } from "@/hooks/use-uids";
import { usePreferences } from "@/hooks/use-preferences";
import { Input } from "@/components/ui/input";
import { UIDCard } from "@/components/uid-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { UIDEntry } from "@/lib/storage";
import { copyText } from "@/lib/clipboard";

type Filter = "all" | "success" | "error" | "pending";
type SortKey = "fetched" | "newest" | "uid";
const PAGE_SIZE = 300;
const CHUNK_SIZE = 40;

function matchUID(entry: UIDEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (q.includes(",") || q.includes(";")) {
    const prefixes = q.split(/[,;]+/).map(v => v.trim()).filter(Boolean);
    return prefixes.some(prefix => entry.uid.startsWith(prefix));
  }
  return entry.uid.toLowerCase().includes(q) ||
    (entry.name || "").toLowerCase().includes(q) ||
    (entry.username || "").toLowerCase().includes(q);
}

export default function Home() {
  const { uids, batchFetch, deleteUID, toggleSaved, clearAllUIDs } = useUIDs();
  const { prefs } = usePreferences();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("fetched");
  const [page, setPage] = useState(1);
  const [renderCount, setRenderCount] = useState(CHUNK_SIZE);
  const [showPasswords, setShowPasswords] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(() => new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleBatchFetch = useCallback(async (items: UIDEntry[]) => {
    if (items.length === 0) return;
    setFetchingIds(prev => {
      const next = new Set(prev);
      for (const item of items) next.add(item.id);
      return next;
    });
    try {
      await batchFetch(items);
    } finally {
      setFetchingIds(prev => {
        const next = new Set(prev);
        for (const item of items) next.delete(item.id);
        return next;
      });
    }
  }, [batchFetch]);

  useEffect(() => {
    const pending = uids.filter(u => u.status === "pending" && !u.fetchedAt);
    if (pending.length) void handleBatchFetch(pending);
    // Resume an interrupted import just once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!prefs.autoRetry) return;
    const failed = uids.filter(u => u.status === "error" && !fetchingIds.has(u.id));
    if (failed.length) void handleBatchFetch(failed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.autoRetry]);

  const stats = useMemo(() => ({
    total: uids.length,
    success: uids.filter(u => u.status === "success").length,
    error: uids.filter(u => u.status === "error").length,
    pending: uids.filter(u => u.status === "pending").length,
  }), [uids]);

  const filtered = useMemo(() => {
    const rows = uids.filter(u => (filter === "all" || u.status === filter) && matchUID(u, search));
    if (sort === "uid") rows.sort((a, b) => a.uid.localeCompare(b.uid, undefined, { numeric: true }));
    else if (sort === "fetched") rows.sort((a, b) => (b.fetchedAt || "").localeCompare(a.fetchedAt || ""));
    return rows;
  }, [uids, filter, search, sort]);

  const maxPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, maxPages);
  const first = (safePage - 1) * PAGE_SIZE;
  const pageUIDs = filtered.slice(first, first + PAGE_SIZE);
  const renderedUIDs = pageUIDs.slice(0, renderCount);

  useEffect(() => { setPage(1); setRenderCount(CHUNK_SIZE); }, [filter, search, sort]);
  useEffect(() => { setRenderCount(CHUNK_SIZE); }, [safePage]);

  useEffect(() => {
    if (renderCount >= pageUIDs.length) return;
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setRenderCount(v => Math.min(PAGE_SIZE, v + CHUNK_SIZE));
    }, { rootMargin: "950px" });
    io.observe(node);
    return () => io.disconnect();
  }, [renderCount, pageUIDs.length, safePage]);

  const done = stats.success + stats.error;
  const progress = stats.total ? Math.round(done * 100 / stats.total) : 0;
  const active = fetchingIds.size > 0;

  const copySelected = (withPassword: boolean) => {
    const text = uids.filter(u => checkedIds.has(u.id))
      .map(u => withPassword ? u.uid + "|" + (u.password || "") : u.uid)
      .join("\n");
    if (text) void copyText(text);
  };

  const metrics: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: stats.total },
    { key: "success", label: "Success", count: stats.success },
    { key: "error", label: "Failed", count: stats.error },
    { key: "pending", label: "Pending", count: stats.pending },
  ];

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <section className="rounded-[22px] border border-card-border bg-gradient-to-b from-[#172336] to-[#0f1929] px-3.5 py-4 shadow-md" aria-label="Fetch status">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-2 text-[11px] font-mono">
              <span className={`h-2 w-2 rounded-full ${active ? "bg-amber-400 animate-pulse" : "bg-[var(--success)]"}`} />
              <strong className="font-semibold text-[var(--text-primary)]">{active ? "Running" : stats.pending ? "Ready" : "Done"}</strong>
              <span className="text-[var(--primary)]">{progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#25344e] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-[#36a2ff] transition-all duration-300" style={{ width: progress + "%" }} />
            </div>
          </div>
          <div className="flex gap-1.5 items-center border-l border-card-border pl-2.5">
            <button onClick={() => setShowPasswords(v => !v)} className={`rounded-xl p-2 transition-colors ${showPasswords ? "bg-[var(--primary)] text-white" : "bg-[var(--primary-dim)] text-[var(--primary)]"}`} title={showPasswords ? "Hide passwords" : "Show passwords"} aria-label={showPasswords ? "Hide passwords" : "Show passwords"}>
              {showPasswords ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
            <button disabled={stats.error === 0 || active} onClick={() => void handleBatchFetch(uids.filter(u => u.status === "error"))} className="flex items-center gap-1 rounded-xl bg-[#24334c] px-2.5 py-2 text-xs font-mono text-[var(--text-primary)] disabled:opacity-50">
              <RotateCw className={`h-4 w-4 ${active ? "animate-spin" : ""}`} /> Retry
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button aria-label="More actions" className="p-1 text-[var(--text-muted)]"><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card text-[var(--text-primary)] border-card-border">
                <DropdownMenuItem onClick={() => void handleBatchFetch(uids.filter(u => u.status === "pending"))}>Fetch pending</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCheckedIds(new Set(pageUIDs.map(u => u.id)))}>Select this page</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCheckedIds(new Set())}>Deselect all</DropdownMenuItem>
                <DropdownMenuItem onClick={() => copySelected(false)} disabled={!checkedIds.size}>Copy selected UIDs</DropdownMenuItem>
                <DropdownMenuItem onClick={() => copySelected(true)} disabled={!checkedIds.size}>Copy selected UID|Pass</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-[var(--error)]" onClick={() => { if (confirm("Delete ALL saved UIDs on this browser?")) clearAllUIDs(); }}>Delete all</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5 border-t border-card-border mt-4 pt-3">
          {metrics.map(item => (
            <button key={item.key} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className={`rounded-[18px] border py-2.5 px-0.5 text-center min-w-0 ${filter === item.key ? "border-[var(--primary)] bg-[#203753] text-[var(--text-primary)]" : "border-[#243551] text-[var(--text-muted)]"}`}>
              <span className="block text-[11px] font-mono">{item.label}</span>
              <strong className="block text-[12px] font-mono tabular-nums">{item.count.toLocaleString()}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="relative">
        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
        <Input id="uid-operator-search" aria-label="UID Separator" placeholder="UID Separator — 61, 1000, 10000..." value={search} onChange={e => setSearch(e.target.value)} className="h-12 pl-10 rounded-[18px] bg-[#111c2e] border-[#22334e] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] font-mono text-sm" />
      </div>
      <div className="flex items-center justify-between px-1 gap-2 text-[12px]">
        <span className="text-[var(--text-muted)] whitespace-nowrap">Showing <b className="text-[var(--text-primary)]">{filtered.length.toLocaleString()}</b> / {stats.total.toLocaleString()} UIDs</span>
        <div className="flex items-center gap-2">
          <button onClick={() => { setSearch(""); setFilter("all"); setPage(1); }} className="text-[var(--primary)]">Reset</button>
          <select aria-label="Sort results" value={sort} onChange={e => setSort(e.target.value as SortKey)} className="rounded-full border border-[#243551] bg-[#101b2c] px-2.5 py-2 text-[var(--text-primary)]">
            <option value="fetched">Fetched</option><option value="newest">Imported</option><option value="uid">UID</option>
          </select>
        </div>
      </div>

      <div className="rounded-[19px] border border-[#243551] bg-[#111c2e] px-3 py-3 flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span className="tabular-nums">{filtered.length ? `${(first + 1).toLocaleString()}–${Math.min(first + PAGE_SIZE, filtered.length).toLocaleString()} of ${filtered.length.toLocaleString()} · Page ${safePage}/${maxPages}` : "0 of 0 · Page 1/1"}</span>
        <div className="flex items-center gap-1">
          <button disabled={safePage === 1} onClick={() => setPage(v => Math.max(1, v - 1))} className="inline-flex items-center rounded-xl border border-card-border px-2.5 py-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" />Prev</button>
          <button disabled={safePage === maxPages} onClick={() => { setPage(v => Math.min(maxPages, v + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="inline-flex items-center rounded-xl border border-card-border px-2.5 py-2 text-[var(--text-primary)] disabled:opacity-40">Next<ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-card-border bg-card p-10 flex flex-col items-center text-center">
          <Users className="h-10 w-10 text-[var(--primary)] mb-3" />
          <strong>No UIDs found</strong>
          <p className="text-xs text-[var(--text-muted)] my-2">{stats.total ? "No matching records." : "Import UIDs to get started. Existing local Termux data is not synced automatically."}</p>
          {!stats.total && <Link href="/import" className="inline-flex items-center gap-2 bg-[var(--primary)] text-white px-4 py-2 rounded-xl mt-1"><Plus className="h-4 w-4" /> Import Now</Link>}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 pb-6">
          {renderedUIDs.map(entry => (
            <UIDCard key={entry.id} entry={entry} onToggleSaved={toggleSaved} onDelete={deleteUID} onFetch={u => void handleBatchFetch([u])} showPassword={showPasswords} isFetching={fetchingIds.has(entry.id)} checked={checkedIds.has(entry.id)} onCheck={(id,checked) => setCheckedIds(prev => { const next = new Set(prev); checked ? next.add(id) : next.delete(id); return next; })} swipeToDelete={prefs.swipeToDelete} />
          ))}
          {renderCount < pageUIDs.length && <div ref={sentinelRef} className="text-center text-xs text-[var(--text-muted)] py-5">Loading cards… {renderedUIDs.length}/{pageUIDs.length}</div>}
        </div>
      )}
    </div>
  );
}
