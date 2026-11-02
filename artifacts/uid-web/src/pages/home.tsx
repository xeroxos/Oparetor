import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Search, Plus, Users, MoreHorizontal, Camera, Check, AlertCircle, RotateCw, Eye, EyeOff } from "lucide-react";
import { useUIDs } from "@/hooks/use-uids";
import { usePreferences } from "@/hooks/use-preferences";
import { Input } from "@/components/ui/input";
import { UIDCard } from "@/components/uid-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { UIDEntry } from "@/lib/storage";
import { copyText } from "@/lib/clipboard";

export default function Home() {
  const { uids, batchFetch, deleteUID, toggleSaved, clearAllUIDs } = useUIDs();
  const { prefs } = usePreferences();
  const [search, setSearch] = useState("");
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [showPasswords, setShowPasswords] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const markFetching = (ids: string[], on: boolean) => {
    setFetchingIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => on ? next.add(id) : next.delete(id));
      return next;
    });
  };

  const handleBatchFetch = useCallback(async (toFetch: UIDEntry[]) => {
    if (toFetch.length === 0) return;
    const ids = toFetch.map(e => e.id);
    markFetching(ids, true);
    await batchFetch(toFetch);
    markFetching(ids, false);
  }, [batchFetch]);

  const handleFetchOne = useCallback((entry: UIDEntry) => {
    handleBatchFetch([entry]);
  }, [handleBatchFetch]);

  const handleCheck = useCallback((id: string, checked: boolean) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  // Auto-fetch pending UIDs on mount
  useEffect(() => {
    const pending = uids.filter(u => u.status === "pending" && !u.fetchedAt);
    if (pending.length > 0) handleBatchFetch(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-retry failed UIDs when setting is on
  useEffect(() => {
    if (!prefs.autoRetry) return;
    const failed = uids.filter(u => u.status === "error" && !fetchingIds.has(u.id));
    if (failed.length > 0) handleBatchFetch(failed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.autoRetry]);

  const filteredUIDs = useMemo(() => {
    const lower = search.toLowerCase();
    return uids
      .filter(u =>
        u.uid.toLowerCase().includes(lower) ||
        (u.name && u.name.toLowerCase().includes(lower)) ||
        (u.username && u.username.toLowerCase().includes(lower))
      )
      .sort((a, b) => {
        const tA = a.fetchedAt ? new Date(a.fetchedAt).getTime() : 0;
        const tB = b.fetchedAt ? new Date(b.fetchedAt).getTime() : 0;
        return tB - tA;
      });
  }, [uids, search]);

  // Incremental rendering — only mount a window of cards so a 700+ list stays
  // smooth instead of rendering every card (and image) at once.
  useEffect(() => { setVisibleCount(40); }, [search]);

  const visibleUIDs = useMemo(
    () => filteredUIDs.slice(0, visibleCount),
    [filteredUIDs, visibleCount]
  );

  useEffect(() => {
    if (visibleCount >= filteredUIDs.length) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) setVisibleCount(c => c + 40); },
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, filteredUIDs.length]);

  const stats = useMemo(() => ({
    total: uids.length,
    success: uids.filter(u => u.status === "success").length,
    error: uids.filter(u => u.status === "error").length,
    pending: uids.filter(u => u.status === "pending").length,
    hasPic: uids.filter(u => !!u.profilePic).length,
    hasIg: uids.filter(u => u.hasInstagram).length,
  }), [uids]);

  const copySelectedUIDs = () => {
    const text = uids.filter(u => checkedIds.has(u.id)).map(u => u.uid).join("\n");
    if (text) void copyText(text);
  };

  const copySelectedFull = () => {
    const text = uids.filter(u => checkedIds.has(u.id)).map(u => `${u.uid}|${u.password || ""}`).join("\n");
    if (text) void copyText(text);
  };

  return (
    <div className="flex flex-col p-3 space-y-3">

      {/* Stats bar */}
      <div className="flex items-center justify-between bg-card border border-card-border rounded-lg px-2.5 py-2 text-xs font-mono gap-2">
        {/* Left: stats */}
        <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap hide-scrollbar">
          <span className="text-[var(--text-primary)] font-semibold">Total: {stats.total}</span>
          <span className="text-[var(--success)] flex items-center gap-0.5"><Check className="w-3 h-3" /> {stats.success}</span>
          <span className="text-[var(--primary)] flex items-center gap-0.5"><Camera className="w-3 h-3" /> {stats.hasPic}</span>
          <span className="ig-gradient font-bold">IG {stats.hasIg}</span>
          <span className="text-[var(--error)] flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> {stats.error}</span>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-1.5 shrink-0 border-l border-card-border pl-2">
          {/* Global show/hide password */}
          <button
            onClick={() => setShowPasswords(v => !v)}
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors border ${
              showPasswords
                ? "bg-[var(--primary)] border-[var(--primary)] text-white"
                : "bg-transparent border-card-border text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
            title={showPasswords ? "Hide all passwords" : "Show all passwords"}
          >
            {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>

          {/* Retry failed */}
          {stats.error > 0 && (
            <button
              onClick={() => handleBatchFetch(uids.filter(u => u.status === "error"))}
              className="flex items-center gap-1 h-7 px-2 bg-[var(--card-border)] hover:bg-[var(--primary)] hover:text-white rounded-md transition-colors text-[var(--text-primary)] text-xs"
            >
              <RotateCw className="w-3 h-3" /> Retry
            </button>
          )}

          {/* 3-dot menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--card-border)] text-[var(--text-muted)] transition-colors">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 bg-card border-card-border text-[var(--text-primary)]">
              {stats.pending > 0 && (
                <DropdownMenuItem onClick={() => handleBatchFetch(uids.filter(u => u.status === "pending"))}>
                  Fetch All Pending ({stats.pending})
                </DropdownMenuItem>
              )}
              {stats.error > 0 && (
                <DropdownMenuItem onClick={() => handleBatchFetch(uids.filter(u => u.status === "error"))}>
                  Retry All Failed ({stats.error})
                </DropdownMenuItem>
              )}
              {(stats.pending > 0 || stats.error > 0) && <DropdownMenuSeparator className="bg-[var(--card-border)]" />}
              <DropdownMenuItem onClick={() => setCheckedIds(new Set(uids.map(u => u.id)))}>
                Select All
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCheckedIds(new Set())}>
                Deselect All
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copySelectedUIDs} disabled={checkedIds.size === 0}>
                Copy Selected (UID only)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copySelectedFull} disabled={checkedIds.size === 0}>
                Copy Selected (uid|pass)
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[var(--card-border)]" />
              <DropdownMenuItem
                className="text-[var(--error)] focus:text-[var(--error)] focus:bg-red-500/10"
                onClick={() => { if (confirm("Delete all UIDs?")) clearAllUIDs(); }}
              >
                Delete All
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <Input
          placeholder="Search by UID, name, or username..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 bg-card border-card-border text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:ring-[var(--primary)]"
          data-testid="input-search"
        />
      </div>

      {/* Card list */}
      {filteredUIDs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center bg-card rounded-xl border border-card-border border-dashed">
          <Users className="w-10 h-10 text-[var(--text-muted)] mb-3 opacity-50" />
          <h3 className="text-base font-medium text-[var(--text-primary)]">No UIDs found</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1 mb-4 max-w-[250px]">
            {uids.length === 0
              ? "Your list is empty. Import some UIDs to get started."
              : "No UIDs match your search."}
          </p>
          {uids.length === 0 && (
            <Link
              href="/import"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-[var(--primary)] text-white hover:opacity-90 h-9 px-4"
            >
              <Plus className="w-4 h-4 mr-2" /> Import Now
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-6">
          {visibleUIDs.map(entry => (
            <UIDCard
              key={entry.id}
              entry={entry}
              onToggleSaved={toggleSaved}
              onDelete={deleteUID}
              onFetch={handleFetchOne}
              showPassword={showPasswords}
              isFetching={fetchingIds.has(entry.id)}
              checked={checkedIds.has(entry.id)}
              onCheck={handleCheck}
              swipeToDelete={prefs.swipeToDelete}
            />
          ))}
          {visibleCount < filteredUIDs.length && (
            <div ref={sentinelRef} className="py-4 text-center text-xs text-[var(--text-muted)]">
              Loading more… ({visibleUIDs.length}/{filteredUIDs.length})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
