import { useState, useEffect, useCallback } from "react";
import { getPreferences, savePreferences, type AppPreferences } from "@/lib/storage";

export function usePreferences() {
  const [prefs, setPrefs] = useState<AppPreferences>(getPreferences());

  useEffect(() => {
    const handleUpdate = () => {
      setPrefs(getPreferences());
    };
    window.addEventListener("prefs-updated", handleUpdate);
    return () => window.removeEventListener("prefs-updated", handleUpdate);
  }, []);

  const updatePref = useCallback(<K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
    savePreferences({ [key]: value });
  }, []);

  return { prefs, updatePref };
}
