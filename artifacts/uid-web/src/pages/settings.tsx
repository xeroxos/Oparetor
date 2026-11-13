import { useState } from "react";
import { Moon, Sun, Trash2, Database, Download, FileJson, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/hooks/use-preferences";
import { useUIDs } from "@/hooks/use-uids";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { getUIDs, waitForUIDStorage, getFBCookie, saveFBCookie } from "@/lib/storage";

export default function Settings() {
  const { prefs, updatePref } = usePreferences();
  const { uids, clearAllUIDs } = useUIDs();
  const { toast } = useToast();
  const [fbCookie, setFBCookie] = useState(() => getFBCookie());
  const [revealCookie, setRevealCookie] = useState(false);
  const [cookieEdited, setCookieEdited] = useState(false);
  const saveSession = () => {
    saveFBCookie(fbCookie.trim());
    setCookieEdited(false);
    toast({
      title: fbCookie.trim() ? "Session saved on this device" : "Session cleared",
      description: "The session is used only for profile lookup requests; imported UID passwords are never sent.",
    });
  };


  const handleClearData = () => {
    if (confirm("সব UID ডিলিট হয়ে যাবে। নিশ্চিত?")) {
      clearAllUIDs();
      toast({ title: "ডিলিট হয়েছে", description: "সব UID মুছে ফেলা হয়েছে।" });
    }
  };

  const download = (name: string, text: string, mime: string) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportBackup = async (format: "json" | "txt") => {
    await waitForUIDStorage();
    const records = getUIDs();
    if (!records.length) {
      toast({ title: "No UIDs to export" });
      return;
    }
    if (records.some(row => row.password) &&
        !confirm("This backup contains plaintext passwords. Save it only to a private device?")) return;
    if (format === "json") {
      download("uid-operator-backup-" + new Date().toISOString().slice(0, 10) + ".json",
        JSON.stringify(records, null, 2), "application/json");
    } else {
      download("uid-operator-" + new Date().toISOString().slice(0, 10) + ".txt",
        records.map(row => row.uid + (row.password ? "|" + row.password : "")).join("\n"), "text/plain");
    }
    toast({ title: "Backup exported", description: records.length.toLocaleString() + " UIDs included" });
  };

  return (
    <div className="flex flex-col p-4 space-y-5 pb-24">
      <h2 className="text-xl font-bold">Settings</h2>

      {/* ── THEME ── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Theme</h3>
        <Card className="bg-card">
          <CardContent className="p-3">
            <div className="flex bg-muted rounded-md p-1">
              <Button
                variant="ghost"
                className={`flex-1 h-8 ${prefs.theme === "dark" ? "bg-background shadow-sm" : ""}`}
                onClick={() => updatePref("theme", "dark")}
                data-testid="theme-dark"
              >
                <Moon className="w-4 h-4 mr-2" />Dark
              </Button>
              <Button
                variant="ghost"
                className={`flex-1 h-8 ${prefs.theme === "light" ? "bg-background shadow-sm" : ""}`}
                onClick={() => updatePref("theme", "light")}
                data-testid="theme-light"
              >
                <Sun className="w-4 h-4 mr-2" />Light
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── FONT SIZE ── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Font Size</h3>
        <Card className="bg-card">
          <CardContent className="p-3">
            <div className="flex bg-muted rounded-md p-1">
              {(["sm", "md", "lg"] as const).map(size => (
                <Button
                  key={size}
                  variant="ghost"
                  className={`flex-1 h-8 uppercase ${prefs.fontSize === size ? "bg-background shadow-sm" : ""}`}
                  onClick={() => updatePref("fontSize", size)}
                  data-testid={`font-${size}`}
                >
                  {size}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── VIEW MODE ── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">View Mode</h3>
        <Card className="bg-card">
          <CardContent className="p-3">
            <div className="flex bg-muted rounded-md p-1">
              <Button
                variant="ghost"
                className={`flex-1 h-8 ${prefs.viewMode === "full" ? "bg-background shadow-sm" : ""}`}
                onClick={() => updatePref("viewMode", "full")}
                data-testid="view-full"
              >
                Full
              </Button>
              <Button
                variant="ghost"
                className={`flex-1 h-8 ${prefs.viewMode === "compact" ? "bg-background shadow-sm" : ""}`}
                onClick={() => updatePref("viewMode", "compact")}
                data-testid="view-compact"
              >
                Compact
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Legacy optional Facebook session; local browser only */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Profile fetching session</h3>
        <Card className="bg-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <ShieldCheck className="h-4 w-4 text-[var(--primary)]" />
              Previous session-backed fetching mode
            </div>
            <p className="text-xs text-muted-foreground">
              Optional: enter a session for an account you own or are authorized to use.
              The session goes to this app's Railway backend when you fetch profiles.
              Keep it private and do not share it in chat. Without a valid session,
              Facebook may display a login page and some profile details may be unavailable.
            </p>
            <div className="flex gap-2">
              <Input type={revealCookie ? "text" : "password"}
                value={fbCookie} autoComplete="off" autoCapitalize="none"
                spellCheck={false} placeholder="Optional authorized session cookie"
                aria-label="Optional Facebook session cookie"
                onChange={e => { setFBCookie(e.target.value); setCookieEdited(true); }}
                className="min-w-0 bg-background font-mono text-xs"
                data-testid="fb-session-cookie" />
              <Button type="button" size="sm" variant="outline"
                onClick={() => setRevealCookie(v => !v)}>{revealCookie ? "Hide" : "Show"}</Button>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={!cookieEdited}
                onClick={saveSession} data-testid="save-fb-cookie">Save session</Button>
              <Button type="button" size="sm" variant="outline"
                onClick={() => { setFBCookie(""); saveFBCookie(""); setCookieEdited(false); }}
                data-testid="clear-fb-cookie">Clear</Button>
            </div>
            <p className="text-xs text-muted-foreground">Session secrets are saved in this browser's local storage. Avoid shared devices. Clearing browser data removes them.</p>
          </CardContent>
        </Card>
      </div>

      {/* ── PREFERENCES ── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Preferences</h3>
        <Card className="bg-card">
          <CardContent className="p-4 space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Swipe to delete</Label>
                <p className="text-xs text-muted-foreground">প্রতিটি card-এ Delete বাটন দেখাবে।</p>
              </div>
              <Switch
                checked={prefs.swipeToDelete}
                onCheckedChange={v => updatePref("swipeToDelete", v)}
                data-testid="toggle-swipe-delete"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Auto-retry failed fetches</Label>
                <p className="text-xs text-muted-foreground">Failed UID গুলো manually refresh করতে হবে।</p>
              </div>
              <Switch
                checked={prefs.autoRetry}
                onCheckedChange={v => updatePref("autoRetry", v)}
                data-testid="toggle-auto-retry"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* LOCAL BACKUP / RECOVERY — never transmitted to Railway */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Backup & Restore</h3>
        <Card className="bg-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm"><Download className="w-4 h-4 text-[var(--primary)]" />Local browser backup</div>
            <p className="text-xs text-muted-foreground">Saved only on your device. Export before clearing browser data or changing from Termux localhost to the Railway domain.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void exportBackup("json")}><FileJson className="w-4 h-4 mr-1" />Export JSON</Button>
              <Button variant="outline" size="sm" onClick={() => void exportBackup("txt")}><FileText className="w-4 h-4 mr-1" />Export UID|Pass</Button>
              <Link href="/import" className="inline-flex items-center border border-card-border rounded-md px-3 text-xs text-[var(--primary)]">Restore backup</Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── STORAGE ── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">Storage</h3>
        <Card className="bg-card">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-muted rounded-full">
                <Database className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <Label className="text-base">Local data</Label>
                <p className="text-xs text-muted-foreground">{uids.length} UID সংরক্ষিত</p>
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={handleClearData} data-testid="clear-all-btn">
              <Trash2 className="w-4 h-4 mr-2" />
              Clear all
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
