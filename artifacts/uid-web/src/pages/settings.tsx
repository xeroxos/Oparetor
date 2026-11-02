import { useState } from "react";
import { Moon, Sun, Trash2, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { usePreferences } from "@/hooks/use-preferences";
import { useUIDs } from "@/hooks/use-uids";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { prefs, updatePref } = usePreferences();
  const { uids, clearAllUIDs } = useUIDs();
  const { toast } = useToast();

  const handleClearData = () => {
    if (confirm("সব UID ডিলিট হয়ে যাবে। নিশ্চিত?")) {
      clearAllUIDs();
      toast({ title: "ডিলিট হয়েছে", description: "সব UID মুছে ফেলা হয়েছে।" });
    }
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
