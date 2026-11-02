import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Home as HomeIcon, Upload, Star, Settings as SettingsIcon, Search, Fingerprint } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Import from "@/pages/import";
import Saved from "@/pages/saved";
import Settings from "@/pages/settings";
import AdminPage from "@/pages/admin";
import { usePreferences } from "@/hooks/use-preferences";

const queryClient = new QueryClient();

function AppHeader() {
  const [, setLocation] = useLocation();
  return (
    <header className="app-header h-14 bg-card/90 border-b border-card-border flex items-center justify-between px-4 sticky top-0 z-20 shrink-0 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <div className="brand-mark" aria-hidden="true">
          <Fingerprint className="w-4 h-4" />
        </div>
        <h1 className="font-bold text-[17px] tracking-[-0.02em] text-[var(--text-primary)]">
          UID <span className="text-[var(--primary)]">Operator</span>
        </h1>
      </div>
      <button
        onClick={() => setLocation('/')}
        className="header-action text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors"
        aria-label="Go to UID search"
        title="Search UIDs"
      >
        <Search className="w-4 h-4" />
      </button>
    </header>
  );
}

function BottomNav() {
  const [location] = useLocation();

  const tabs = [
    { href: "/", icon: HomeIcon, label: "HOME" },
    { href: "/import", icon: Upload, label: "IMPORT" },
    { href: "/saved", icon: Star, label: "SAVED" },
    { href: "/settings", icon: SettingsIcon, label: "SETTINGS" },
  ];

  return (
    <nav className="bottom-nav fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md border-t border-card-border bg-card/90 backdrop-blur-xl flex items-center justify-around px-2 z-50" aria-label="Primary navigation">
      {tabs.map((tab) => {
        const isActive = location === tab.href;
        const Icon = tab.icon;
        return (
          <Link key={tab.href} href={tab.href} aria-current={isActive ? "page" : undefined} className={`nav-item flex flex-col items-center justify-center w-full gap-1 transition-colors ${isActive ? "is-active text-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
            <span className="nav-icon"><Icon className="w-5 h-5" /></span>
            <span className="text-[10px] font-medium tracking-wide">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Router() {
  const [location] = useLocation();

  if (location === "/admin") {
    return <AdminPage />;
  }

  return (
    <div className="app-shell flex flex-col w-full min-h-[100dvh] max-w-md mx-auto bg-background relative">
      <AppHeader />
      <main className="flex-1 overflow-y-auto pb-4" id="main-content">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/import" component={Import} />
          <Route path="/saved" component={Saved} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <BottomNav />
    </div>
  );
}

function App() {
  const { prefs } = usePreferences();

  useEffect(() => {
    if (prefs.theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [prefs.theme]);

  useEffect(() => {
    document.documentElement.classList.remove("text-sm", "text-base", "text-lg");
    if (prefs.fontSize === "sm") document.documentElement.classList.add("text-sm");
    if (prefs.fontSize === "md") document.documentElement.classList.add("text-base");
    if (prefs.fontSize === "lg") document.documentElement.classList.add("text-lg");
  }, [prefs.fontSize]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="bg-background min-h-[100dvh]">
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
