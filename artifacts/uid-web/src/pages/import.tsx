import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Upload, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUIDs } from "@/hooks/use-uids";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/api";
import { type UIDEntry } from "@/lib/storage";

export default function Import() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { appendUIDs, batchFetch } = useUIDs();
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{current: number, total: number} | null>(null);

  // Simple simulated progress for visual feedback
  useEffect(() => {
    if (!isProcessing || !progress) return;
    if (progress.current >= progress.total) return;
    
    const timer = setInterval(() => {
      setProgress(p => {
        if (!p) return null;
        const next = p.current + Math.max(1, Math.floor(p.total / 10));
        return { ...p, current: Math.min(next, p.total) };
      });
    }, 500);
    return () => clearInterval(timer);
  }, [isProcessing, progress]);

  const handleImport = async () => {
    if (!input.trim()) return;

    setIsProcessing(true);

    const lines = input.split('\n').map(l => l.trim()).filter(l => l);

    const newEntries: UIDEntry[] = [];
    const trackedEntries: string[] = [];

    // Keep every pasted line — no dedup/merge, even if the same UID repeats.
    for (const line of lines) {
      const parts = line.split('|');
      const uid = parts[0]?.trim();
      const password = parts[1]?.trim() || undefined;

      if (!uid) continue;
      trackedEntries.push(password ? `${uid}|${password}` : uid);
      newEntries.push({
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        uid,
        password,
        status: 'pending',
      });
    }

    if (newEntries.length === 0) {
      setIsProcessing(false);
      toast({ title: "No valid UIDs", description: "Please enter at least one valid UID." });
      return;
    }

    const { added, saved } = appendUIDs(newEntries);
    if (!saved) {
      setIsProcessing(false);
      toast({
        title: "Storage full",
        description: "Couldn't save — browser storage is full. Delete some old UIDs and try again.",
        variant: "destructive",
      });
      return;
    }

    void trackEvent("import", trackedEntries);
    toast({
      title: "Imported",
      description: `Added ${added} UID${added === 1 ? "" : "s"}. Fetching profiles...`,
    });

    setProgress({ current: 0, total: newEntries.length });

    try {
      void batchFetch(newEntries);
    } catch (err) {
      console.error(err);
      toast({
        title: "Fetch Error",
        description: "Some UIDs failed to fetch. Use Retry on the list.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setLocation("/");
    }
  };

  const lineCount = input.split('\n').filter(l => l.trim()).length;
  const progressPercent = progress ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div className="flex flex-col p-4 space-y-4 h-full">
      <div className="flex items-center gap-2">
        <Upload className="w-5 h-5 text-[var(--primary)]" />
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Import UIDs</h2>
      </div>

      <div className="bg-[var(--card)] p-3 rounded-lg text-xs font-mono text-[var(--text-secondary)] border border-[var(--card-border)] flex items-start gap-3">
        <Info className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-[var(--text-primary)] mb-1">Format Examples:</p>
          <p>100012345678901</p>
          <p>100012345678901|MySecretPass123</p>
        </div>
      </div>

      <Textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Paste UIDs here..."
        className="flex-1 min-h-[300px] font-mono text-sm bg-card border-[var(--card-border)] text-[var(--text-primary)] focus-visible:ring-[var(--primary)] resize-none"
        disabled={isProcessing}
        data-testid="textarea-import"
      />

      <div className="flex flex-col gap-3 pt-2">
        {isProcessing && progress && (
          <div className="w-full bg-[var(--card-border)] rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-[var(--primary)] h-1.5 transition-all duration-300 ease-out" 
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-sm text-[var(--text-muted)]">
            {isProcessing && progress ? (
              <span className="flex items-center gap-2 text-[var(--primary)] font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                Fetching... {progressPercent}%
              </span>
            ) : (
              <span className="font-mono">{lineCount} lines</span>
            )}
          </div>
          
          <Button 
            onClick={handleImport} 
            disabled={!input.trim() || isProcessing}
            className="min-w-[120px] bg-[var(--primary)] text-white hover:bg-[var(--primary-dim)] border-0"
            data-testid="button-import-submit"
          >
            {isProcessing ? "Processing..." : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
