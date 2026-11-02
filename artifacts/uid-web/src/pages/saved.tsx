import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { Search, Star, Bookmark, Eye, EyeOff } from "lucide-react";
import { useUIDs } from "@/hooks/use-uids";
import { Input } from "@/components/ui/input";
import { UIDCard } from "@/components/uid-card";
import { Badge } from "@/components/ui/badge";
import type { UIDEntry } from "@/lib/storage";

export default function Saved() {
  const { uids, deleteUID, toggleSaved, batchFetch } = useUIDs();
  const [search, setSearch] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set());

  const savedUIDs = useMemo(() => uids.filter(u => u.saved), [uids]);

  const filteredUIDs = useMemo(() => {
    const lower = search.toLowerCase();
    return savedUIDs
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
  }, [savedUIDs, search]);

  const handleFetch = useCallback(async (entry: UIDEntry) => {
    setFetchingIds(prev => new Set(prev).add(entry.id));
    await batchFetch([entry]);
    setFetchingIds(prev => { const n = new Set(prev); n.delete(entry.id); return n; });
  }, [batchFetch]);

  return (
    <div className="flex flex-col p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-[var(--warning)] fill-[var(--warning)]" />
          <h2 className="text-xl font-bold text-[var(--text-primary)]">Saved UIDs</h2>
          <Badge variant="secondary" className="rounded-full bg-[var(--card-border)] text-[var(--text-primary)] hover:bg-[var(--card-border)]">
            {savedUIDs.length}
          </Badge>
        </div>
        {savedUIDs.length > 0 && (
          <button
            onClick={() => setShowPasswords(v => !v)}
            className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors border ${
              showPasswords
                ? "bg-[var(--primary)] border-[var(--primary)] text-white"
                : "bg-transparent border-card-border text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
            title={showPasswords ? "Hide passwords" : "Show passwords"}
          >
            {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>

      {savedUIDs.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <Input
            placeholder="Search saved UIDs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card border-card-border text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:ring-[var(--primary)]"
            data-testid="input-search-saved"
          />
        </div>
      )}

      {filteredUIDs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center bg-card rounded-xl border border-card-border border-dashed">
          <Bookmark className="w-10 h-10 text-[var(--text-muted)] mb-3 opacity-50" />
          <h3 className="text-base font-medium text-[var(--text-primary)]">No saved UIDs</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1 mb-4 max-w-[250px]">
            {savedUIDs.length === 0
              ? "Star a UID on the Home tab to save it here."
              : "No saved UIDs match your search."}
          </p>
          {savedUIDs.length === 0 && (
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-[var(--primary)] text-white hover:opacity-90 h-9 px-4"
            >
              Browse Home
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-6">
          {filteredUIDs.map(entry => (
            <UIDCard
              key={entry.id}
              entry={entry}
              onToggleSaved={toggleSaved}
              onDelete={deleteUID}
              onFetch={handleFetch}
              showPassword={showPasswords}
              isFetching={fetchingIds.has(entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
