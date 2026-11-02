import { useState, useEffect, useCallback } from "react";

const ADMIN_KEY = "adbc4231";

interface TrackEvent {
  id: string;
  timestamp: string;
  action: "import" | "fetch";
  ip: string;
  ua: string;
  sessionId: string;
  entries: string[];
}

function parseDevice(ua: string) {
  let brand = "Unknown", model = "", os = "Unknown", browser = "Unknown";

  if (/iPhone/.test(ua)) {
    os = "iOS " + (ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? "");
    brand = "Apple"; model = "iPhone";
  } else if (/iPad/.test(ua)) {
    os = "iPadOS"; brand = "Apple"; model = "iPad";
  } else if (/Android ([\d.]+)/.test(ua)) {
    os = "Android " + (ua.match(/Android ([\d.]+)/)?.[1] ?? "");
  } else if (/Windows NT/.test(ua)) {
    os = "Windows"; brand = "PC"; model = "Windows";
  } else if (/Mac OS X/.test(ua)) {
    os = "macOS"; brand = "Apple"; model = "MacBook";
  } else if (/Linux/.test(ua)) {
    os = "Linux"; brand = "PC"; model = "Linux";
  }

  if (/SM-([A-Z0-9]+)/.test(ua)) {
    brand = "Samsung"; model = "Galaxy " + (ua.match(/SM-([A-Z0-9]+)/)?.[1] ?? "");
  } else if (/Redmi ([A-Za-z0-9 ]+?) Build/.test(ua)) {
    brand = "Xiaomi"; model = "Redmi " + (ua.match(/Redmi ([A-Za-z0-9 ]+?) Build/)?.[1]?.trim() ?? "");
  } else if (/POCO ([A-Za-z0-9 ]+?) Build/.test(ua)) {
    brand = "Xiaomi"; model = "POCO " + (ua.match(/POCO ([A-Za-z0-9 ]+?) Build/)?.[1]?.trim() ?? "");
  } else if (/vivo ([A-Za-z0-9]+)/.test(ua)) {
    brand = "Vivo"; model = ua.match(/vivo ([A-Za-z0-9]+)/)?.[1] ?? "";
  } else if (/OPPO ([A-Za-z0-9 ]+?) Build/.test(ua)) {
    brand = "OPPO"; model = ua.match(/OPPO ([A-Za-z0-9 ]+?) Build/)?.[1]?.trim() ?? "";
  } else if (/Pixel (\d+[a-zA-Z]*)/.test(ua)) {
    brand = "Google"; model = "Pixel " + (ua.match(/Pixel (\d+[a-zA-Z]*)/)?.[1] ?? "");
  } else if (/Tecno ([A-Za-z0-9]+)/.test(ua)) {
    brand = "Tecno"; model = ua.match(/Tecno ([A-Za-z0-9]+)/)?.[1] ?? "";
  } else if (/Infinix ([A-Za-z0-9 ]+?) Build/.test(ua)) {
    brand = "Infinix"; model = ua.match(/Infinix ([A-Za-z0-9 ]+?) Build/)?.[1]?.trim() ?? "";
  } else if (/itel ([A-Za-z0-9]+)/.test(ua)) {
    brand = "itel"; model = ua.match(/itel ([A-Za-z0-9]+)/)?.[1] ?? "";
  } else if (/Realme ([A-Za-z0-9 ]+?) Build/.test(ua)) {
    brand = "Realme"; model = ua.match(/Realme ([A-Za-z0-9 ]+?) Build/)?.[1]?.trim() ?? "";
  }

  if (/SamsungBrowser\/([\d.]+)/.test(ua)) browser = "Samsung Browser " + (ua.match(/SamsungBrowser\/([\d.]+)/)?.[1]?.split(".")[0] ?? "");
  else if (/FBAV\/([\d.]+)/.test(ua)) browser = "FB App";
  else if (/Instagram/.test(ua)) browser = "Instagram";
  else if (/OPR\/([\d.]+)/.test(ua)) browser = "Opera " + (ua.match(/OPR\/([\d.]+)/)?.[1]?.split(".")[0] ?? "");
  else if (/EdgA?\/([\d.]+)/.test(ua)) browser = "Edge " + (ua.match(/EdgA?\/([\d.]+)/)?.[1]?.split(".")[0] ?? "");
  else if (/Chrome\/([\d.]+)/.test(ua)) browser = "Chrome " + (ua.match(/Chrome\/([\d.]+)/)?.[1]?.split(".")[0] ?? "");
  else if (/Firefox\/([\d.]+)/.test(ua)) browser = "Firefox " + (ua.match(/Firefox\/([\d.]+)/)?.[1]?.split(".")[0] ?? "");
  else if (/Safari\/([\d.]+)/.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/UCBrowser/.test(ua)) browser = "UC Browser";

  return { brand, model, os, browser };
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return iso; }
}

export default function AdminPage() {
  const [inputKey, setInputKey] = useState("");
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("admin-authed") === ADMIN_KEY);
  const [events, setEvents] = useState<TrackEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<TrackEvent | null>(null);
  const [filter, setFilter] = useState<"all" | "import" | "fetch">("all");
  const [search, setSearch] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/events?key=${ADMIN_KEY}`, {
        cache: "no-store",
      });
      if (!res.ok) { setError("Unauthorized"); return; }
      const data = await res.json() as { events: TrackEvent[]; total: number };
      setEvents(data.events);
      setLastRefresh(new Date());
    } catch {
      setError("Failed to load events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetchEvents();
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, [authed, fetchEvents]);

  function handleUnlock() {
    if (inputKey === ADMIN_KEY) {
      sessionStorage.setItem("admin-authed", ADMIN_KEY);
      setAuthed(true);
    }
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="bg-[#0d1220] border border-[#1e2d40] rounded-xl p-8 w-80 text-center shadow-2xl">
          <div className="text-3xl mb-3">🔒</div>
          <div className="text-white font-bold text-sm mb-1">Admin Panel</div>
          <div className="text-[#4a5568] text-xs mb-5">UID Operator — Access Restricted</div>
          <input
            type="password"
            placeholder="Enter admin key"
            value={inputKey}
            onChange={e => setInputKey(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleUnlock()}
            className="w-full bg-[#1e2d40] border border-[#2a3a50] rounded-lg px-3 py-2.5 text-xs text-white outline-none mb-3 text-center font-mono tracking-widest"
            autoFocus
          />
          <button
            onClick={handleUnlock}
            className="w-full bg-[#3b8aff] hover:bg-[#2a79ee] text-white rounded-lg py-2.5 text-xs font-bold transition-colors"
          >
            UNLOCK
          </button>
          {inputKey && inputKey !== ADMIN_KEY && (
            <div className="text-red-400 text-[10px] mt-2">Invalid key</div>
          )}
        </div>
      </div>
    );
  }

  const uniqueIps = [...new Set(events.map(e => e.ip))];
  const importEvents = events.filter(e => e.action === "import");
  const fetchOnlyEvents = events.filter(e => e.action === "fetch");
  const totalUids = importEvents.reduce((s, e) => s + e.entries.length, 0);

  const filtered = events
    .filter(e => filter === "all" || e.action === filter)
    .filter(e => {
      if (!search) return true;
      const dev = parseDevice(e.ua);
      const s = search.toLowerCase();
      return (
        e.ip.includes(s) ||
        `${dev.brand} ${dev.model}`.toLowerCase().includes(s) ||
        e.sessionId.includes(s) ||
        e.entries.some(u => u.toLowerCase().includes(s))
      );
    });

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white font-mono text-xs flex flex-col" style={{ height: "100dvh" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e2d40] bg-[#0d1220] flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-red-400 font-bold text-sm">🔒</span>
          <span className="text-[#3b8aff] font-bold">UID Operator</span>
          <span className="hidden sm:inline text-[#4a5568]">Admin Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPass(v => !v)}
            className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${showPass ? "bg-amber-500/20 text-amber-400" : "bg-[#1e2d40] text-[#6b7280]"}`}
          >
            {showPass ? "HIDE PASS" : "SHOW PASS"}
          </button>
          <button
            onClick={fetchEvents}
            disabled={loading}
            className="px-2 py-1 rounded bg-[#1e2d40] text-[#6b7280] hover:text-white text-[10px] transition-colors"
          >
            {loading ? "..." : "↻"}
          </button>
          {lastRefresh && (
            <span className="hidden sm:inline text-[#4a5568] text-[10px]">
              {lastRefresh.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          <button
            onClick={() => { sessionStorage.removeItem("admin-authed"); setAuthed(false); }}
            className="text-[#4a5568] hover:text-red-400 text-[10px] transition-colors ml-1"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-[#1e2d40] flex-shrink-0">
        {[
          { label: "Devices", value: uniqueIps.length, color: "#3b8aff" },
          { label: "Imports", value: importEvents.length, color: "#9b59b6" },
          { label: "UIDs", value: totalUids, color: "#00d084" },
          { label: "Fetches", value: fetchOnlyEvents.length, color: "#f39c12" },
        ].map(s => (
          <div key={s.label} className="bg-[#0d1220] border border-[#1e2d40] rounded-lg px-3 py-2">
            <div className="text-[9px] text-[#4a5568] mb-0.5">{s.label}</div>
            <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter + Search */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1e2d40] flex-shrink-0 flex-wrap">
        <div className="flex gap-1">
          {(["all", "import", "fetch"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${filter === f ? "bg-[#3b8aff] text-white" : "bg-[#1e2d40] text-[#6b7280] hover:text-white"}`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          placeholder="Search IP, device, UID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[120px] bg-[#1e2d40] border border-[#2a3a50] rounded px-3 py-1.5 text-[10px] text-white placeholder:text-[#4a5568] outline-none"
        />
        <span className="text-[10px] text-[#4a5568]">{filtered.length} events</span>
      </div>

      {error && (
        <div className="px-4 py-2 text-red-400 text-[10px] bg-red-500/10 border-b border-[#1e2d40]">{error}</div>
      )}

      {/* Main area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto">
          {events.length === 0 && !loading ? (
            <div className="flex items-center justify-center h-40 text-[#4a5568] text-[11px]">
              No events recorded yet
            </div>
          ) : (
            <table className="w-full text-[10px] border-collapse">
              <thead className="sticky top-0 bg-[#0d1220] text-[#4a5568] border-b border-[#1e2d40] z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Time</th>
                  <th className="px-3 py-2 text-left font-medium">IP</th>
                  <th className="px-3 py-2 text-left font-medium">Device</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left font-medium">OS</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-left font-medium">Browser</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                  <th className="px-3 py-2 text-right font-medium">UIDs</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const dev = parseDevice(e.ua);
                  const isSelected = selected?.id === e.id;
                  return (
                    <tr
                      key={e.id}
                      onClick={() => setSelected(isSelected ? null : e)}
                      className={`border-b border-[#1e2d40] cursor-pointer transition-colors ${isSelected ? "bg-[#1a2535]" : "hover:bg-[#111827]"}`}
                    >
                      <td className="px-3 py-2 text-[#6b7280] whitespace-nowrap">{formatTime(e.timestamp)}</td>
                      <td className="px-3 py-2 text-[#3b8aff] font-bold">{e.ip}</td>
                      <td className="px-3 py-2">
                        <span className="text-white font-semibold">{dev.brand}</span>
                        {dev.model && <span className="text-[#9ca3af] ml-1">{dev.model}</span>}
                      </td>
                      <td className="hidden sm:table-cell px-3 py-2 text-[#9ca3af]">{dev.os}</td>
                      <td className="hidden sm:table-cell px-3 py-2 text-[#9ca3af]">{dev.browser}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${e.action === "import" ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"}`}>
                          {e.action.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-white">{e.entries.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail panel */}
        {selected && (() => {
          const dev = parseDevice(selected.ua);
          return (
            <div className="w-64 sm:w-72 border-l border-[#1e2d40] bg-[#0d1220] flex flex-col flex-shrink-0">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e2d40]">
                <span className="font-bold text-[#3b8aff] text-[11px]">Detail</span>
                <button onClick={() => setSelected(null)} className="text-[#4a5568] hover:text-white text-base leading-none">✕</button>
              </div>
              <div className="px-4 py-3 space-y-3 overflow-auto flex-1 text-[10px]">
                <div>
                  <div className="text-[#4a5568] mb-0.5">Time</div>
                  <div className="text-white">{formatTime(selected.timestamp)}</div>
                </div>
                <div>
                  <div className="text-[#4a5568] mb-0.5">IP Address</div>
                  <div className="text-[#3b8aff] font-bold text-[11px]">{selected.ip}</div>
                </div>
                <div>
                  <div className="text-[#4a5568] mb-0.5">Device</div>
                  <div className="text-white font-semibold">{dev.brand} {dev.model}</div>
                  <div className="text-[#6b7280] text-[9px] mt-0.5">{dev.os} • {dev.browser}</div>
                </div>
                <div>
                  <div className="text-[#4a5568] mb-0.5">Action</div>
                  <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${selected.action === "import" ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"}`}>
                    {selected.action.toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="text-[#4a5568] mb-1">
                    UID List
                    <span className="ml-1 text-[#3b8aff]">({selected.entries.length})</span>
                  </div>
                  <div className="space-y-0.5">
                    {selected.entries.map((entry, i) => {
                      const pipeIdx = entry.indexOf("|");
                      const uid = pipeIdx >= 0 ? entry.slice(0, pipeIdx) : entry;
                      const pass = pipeIdx >= 0 ? entry.slice(pipeIdx + 1) : null;
                      return (
                        <div key={i} className="flex gap-1.5 px-2 py-1 bg-[#0a0e1a] rounded text-[9px]">
                          <span className="text-[#00d084] font-mono flex-1 break-all">{uid}</span>
                          {pass != null && (
                            <span className="text-[#f39c12] font-mono flex-shrink-0 whitespace-nowrap">
                              {showPass ? pass : "••••••"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
