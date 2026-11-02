import { useState, useRef, useEffect, memo } from "react";
import { Copy, Check, Star, Trash2, ExternalLink, Loader2, RefreshCw, MoreVertical } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { copyText } from "@/lib/clipboard";
import type { UIDEntry } from "@/lib/storage";

interface UIDCardProps {
  entry: UIDEntry;
  onToggleSaved: (id: string) => void;
  onDelete?: (id: string) => void;
  onFetch?: (entry: UIDEntry) => void;
  showPassword?: boolean;
  isFetching?: boolean;
  checked?: boolean;
  onCheck?: (id: string, checked: boolean) => void;
  swipeToDelete?: boolean;
}

function UIDCardImpl({
  entry,
  onToggleSaved,
  onDelete,
  onFetch,
  showPassword = false,
  isFetching = false,
  checked,
  onCheck,
  swipeToDelete = false,
}: UIDCardProps) {
  const [copiedUID, setCopiedUID] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);
  const [copiedUser, setCopiedUser] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swiping = useRef(false);
  const didSwipe = useRef(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [menuOpen]);

  const copy = async (text: string, type: "uid" | "pass" | "user") => {
    const ok = await copyText(text);
    if (!ok) return;
    if (type === "uid") { setCopiedUID(true); setTimeout(() => setCopiedUID(false), 2000); }
    else if (type === "pass") { setCopiedPass(true); setTimeout(() => setCopiedPass(false), 2000); }
    else { setCopiedUser(true); setTimeout(() => setCopiedUser(false), 2000); }
  };

  const openFB = () => {
    window.location.href = `fb://profile/${entry.uid}`;
  };

  const initials = entry.name
    ? entry.name.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase()
    : (entry.uid?.substring(0, 2) || "??");

  const onTouchStart = (e: React.TouchEvent) => {
    if (!swipeToDelete || !onDelete) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swiping.current = false;
    didSwipe.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!swipeToDelete || !onDelete) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dy > 20 && !swiping.current) return;
    if (dx < 0) {
      swiping.current = true;
      setSwipeX(Math.max(dx, -100));
    }
  };

  const onTouchEnd = () => {
    if (!swipeToDelete || !onDelete) return;
    if (swiping.current) didSwipe.current = true;
    if (swipeX < -60) {
      onDelete(entry.id);
    }
    setSwipeX(0);
    swiping.current = false;
  };

  // Suppress the synthetic click that follows a horizontal swipe so a swipe
  // starting on a copy/menu button doesn't also trigger that button.
  const onClickCapture = (e: React.MouseEvent) => {
    if (didSwipe.current) {
      e.preventDefault();
      e.stopPropagation();
      didSwipe.current = false;
    }
  };

  return (
    <div
      className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden relative"
      data-testid={`card-uid-${entry.uid}`}
      style={{ transform: `translateX(${swipeX}px)`, transition: swipeX === 0 ? "transform 0.2s ease" : "none" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClickCapture={onClickCapture}
    >
      {/* Swipe-to-delete hint */}
      {swipeToDelete && swipeX < -20 && (
        <div className="absolute right-0 top-0 bottom-0 flex items-center justify-center px-4 bg-red-500/20">
          <Trash2 className="w-5 h-5 text-[var(--error)]" />
        </div>
      )}

      <div className="flex gap-3 p-3">
        {onCheck && (
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onCheck(entry.id, e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer"
              data-testid={`checkbox-${entry.id}`}
            />
          </div>
        )}

        {/* Avatar */}
        <Avatar className="w-[72px] h-[72px] border-2 border-card-border shrink-0 rounded-xl">
          <AvatarImage src={entry.profilePic} alt={entry.name || entry.uid} className="object-cover" loading="lazy" />
          <AvatarFallback className="text-sm font-mono font-bold text-[var(--text-muted)] bg-background rounded-xl">
            {initials}
          </AvatarFallback>
        </Avatar>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {/* Name row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3
                className="font-bold text-[var(--text-primary)] text-sm leading-tight truncate"
                title={entry.name || entry.uid}
              >
                {entry.name || entry.uid}
              </h3>
              {entry.hasInstagram && entry.username && (
                <a
                  href={`https://www.instagram.com/${entry.username}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Instagram: @${entry.username}`}
                  className="shrink-0"
                  onClick={e => e.stopPropagation()}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <defs>
                      <linearGradient id={`ig-${entry.id}`} x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop stopColor="#f09433" offset="0%" />
                        <stop stopColor="#e6683c" offset="25%" />
                        <stop stopColor="#dc2743" offset="50%" />
                        <stop stopColor="#cc2366" offset="75%" />
                        <stop stopColor="#bc1888" offset="100%" />
                      </linearGradient>
                    </defs>
                    <rect x="1" y="1" width="12" height="12" rx="3.5" stroke={`url(#ig-${entry.id})`} strokeWidth="1.5" fill="none"/>
                    <circle cx="7" cy="7" r="2.8" stroke={`url(#ig-${entry.id})`} strokeWidth="1.3" fill="none"/>
                    <circle cx="10.2" cy="3.8" r="0.8" fill={`url(#ig-${entry.id})`}/>
                  </svg>
                </a>
              )}
            </div>

            {/* Right: star + status + 3-dot menu */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onToggleSaved(entry.id)}
                className="text-[var(--text-muted)] hover:text-[var(--warning)] transition-colors p-0.5"
                title={entry.saved ? "Unsave" : "Save"}
                data-testid={`btn-star-${entry.id}`}
                style={{ touchAction: "manipulation" }}
              >
                <Star className={`w-4 h-4 ${entry.saved ? "fill-[var(--warning)] text-[var(--warning)]" : ""}`} />
              </button>

              {entry.status === "success" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/10 text-[var(--success)] border border-green-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] inline-block" /> OK
                </span>
              )}
              {entry.status === "error" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-[var(--error)] border border-red-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--error)] inline-block" /> Err
                </span>
              )}
              {entry.status === "pending" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-[var(--text-muted)] bg-background border border-card-border">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> Wait
                </span>
              )}

              {/* 3-dot menu */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(v => !v)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-0.5 rounded"
                  title="More options"
                  style={{ touchAction: "manipulation" }}
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-6 z-50 min-w-[140px] bg-card border border-card-border rounded-lg shadow-xl py-1">
                    <button
                      onClick={() => { setMenuOpen(false); onFetch?.(entry); }}
                      disabled={isFetching}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--primary)]/10 transition-colors disabled:opacity-50"
                      data-testid={`btn-fetch-${entry.id}`}
                    >
                      {isFetching
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--primary)]" />
                        : <RefreshCw className="w-3.5 h-3.5 text-[var(--primary)]" />}
                      {isFetching ? "Fetching…" : "Fetch"}
                    </button>

                    <button
                      onClick={() => { setMenuOpen(false); openFB(); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--primary)]/10 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[var(--primary)]" />
                      Open FB Profile
                    </button>

                    {onDelete && <div className="my-1 h-px bg-card-border" />}
                    {onDelete && (
                      <button
                        onClick={() => { setMenuOpen(false); onDelete(entry.id); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--error)] hover:bg-red-500/10 transition-colors"
                        data-testid={`btn-delete-${entry.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Username + followers */}
          {(entry.username || entry.followerCount !== undefined) && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              {entry.username && (
                <div className="flex items-center gap-1 min-w-0">
                  <span className="truncate max-w-[110px]">@{entry.username}</span>
                  <button
                    onClick={() => copy(entry.username!, "user")}
                    className="shrink-0 hover:text-[var(--primary)] transition-colors p-0.5"
                    title="Copy Username"
                    style={{ touchAction: "manipulation" }}
                  >
                    {copiedUser
                      ? <Check className="w-3 h-3 text-[var(--success)]" />
                      : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
              {entry.username && entry.followerCount !== undefined && <span>•</span>}
              {entry.followerCount !== undefined && (
                <span className="shrink-0">{entry.followerCount.toLocaleString()} followers</span>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="w-full h-px bg-[var(--card-border)] mt-1" />

          {/* UID row */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[var(--text-muted)] font-mono shrink-0 w-7">UID</span>
            <span
              className="font-mono text-[var(--text-primary)] truncate cursor-pointer hover:text-[var(--primary)] transition-colors flex-1 min-w-0"
              onClick={() => copy(entry.uid, "uid")}
              title="Tap to copy UID"
              style={{ touchAction: "manipulation" }}
            >
              {entry.uid}
            </span>
            <button
              onClick={() => copy(entry.uid, "uid")}
              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors p-1.5"
              title="Copy UID"
              data-testid={`btn-copy-uid-${entry.id}`}
              style={{ touchAction: "manipulation" }}
            >
              {copiedUID
                ? <Check className="w-5 h-5 text-[var(--success)]" />
                : <Copy className="w-5 h-5" />}
            </button>
          </div>

          {/* Password row */}
          {entry.password && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[var(--text-muted)] font-mono shrink-0 w-7">Pass</span>
              <span className="font-mono text-[var(--text-primary)] flex-1 min-w-0 truncate">
                {showPassword ? entry.password : "••••••••"}
              </span>
              <button
                onClick={() => copy(entry.password!, "pass")}
                className="shrink-0 text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors p-1.5"
                title="Copy Password"
                data-testid={`btn-copy-pass-${entry.id}`}
                style={{ touchAction: "manipulation" }}
              >
                {copiedPass
                  ? <Check className="w-5 h-5 text-[var(--success)]" />
                  : <Copy className="w-5 h-5" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Custom comparison: the useUIDs hook re-parses localStorage on every update, so
// entry objects always get new identities. Compare the fields that actually
// affect rendering to avoid re-rendering every card on each batch-fetch update.
export const UIDCard = memo(UIDCardImpl, (prev, next) => {
  const a = prev.entry;
  const b = next.entry;
  return (
    a.id === b.id &&
    a.uid === b.uid &&
    a.status === b.status &&
    a.name === b.name &&
    a.username === b.username &&
    a.profilePic === b.profilePic &&
    a.followerCount === b.followerCount &&
    a.hasInstagram === b.hasInstagram &&
    a.saved === b.saved &&
    a.password === b.password &&
    prev.showPassword === next.showPassword &&
    prev.isFetching === next.isFetching &&
    prev.checked === next.checked &&
    prev.swipeToDelete === next.swipeToDelete &&
    prev.onToggleSaved === next.onToggleSaved &&
    prev.onDelete === next.onDelete &&
    prev.onFetch === next.onFetch &&
    prev.onCheck === next.onCheck
  );
});
