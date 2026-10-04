import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Building2,
  ClipboardList,
  Inbox,
  Layers,
  Mail,
  Menu,
  Monitor,
  Moon,
  ScrollText,
  Shield,
  Sun,
  Users,
  Wrench,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearSession, currentUser } from "@/api";
import { Menu as UserMenu, MenuItem, Sheet } from "@/components/ui/overlays";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";

type LinkItem = { to: string; label: string; icon: ReactNode; adminOnly?: boolean };

const work: LinkItem[] = [
  { to: "/queue", label: "Queue", icon: <Inbox size={16} aria-hidden /> },
  { to: "/eval", label: "Eval", icon: <ClipboardList size={16} aria-hidden /> },
];

const operations: LinkItem[] = [
  { to: "/admin/org", label: "Org", icon: <Building2 size={16} aria-hidden /> },
  { to: "/admin/modules", label: "Modules", icon: <Layers size={16} aria-hidden /> },
  { to: "/admin/policies", label: "Policies", icon: <BookOpen size={16} aria-hidden /> },
  { to: "/admin/mailboxes", label: "Mailboxes", icon: <Mail size={16} aria-hidden /> },
  { to: "/admin/tools", label: "Tools", icon: <Wrench size={16} aria-hidden /> },
  { to: "/admin/rules", label: "Rules", icon: <Shield size={16} aria-hidden /> },
  { to: "/admin/people", label: "People", icon: <Users size={16} aria-hidden /> },
  { to: "/admin/traces", label: "Traces", icon: <ScrollText size={16} aria-hidden /> },
];

const tenant: LinkItem[] = [{ to: "/admin/tenant", label: "Tenant", icon: <Building2 size={16} aria-hidden />, adminOnly: true }];

function titles(pathname: string) {
  if (pathname.startsWith("/tickets/")) return "Ticket";
  const map: Record<string, string> = {
    "/queue": "Queue",
    "/eval": "Eval",
    "/admin/org": "Organization",
    "/admin/modules": "Modules",
    "/admin/policies": "Policies",
    "/admin/mailboxes": "Mailboxes",
    "/admin/tools": "Tools",
    "/admin/rules": "Rules",
    "/admin/people": "People",
    "/admin/traces": "Traces",
    "/admin/tenant": "Tenant",
  };
  return map[pathname] ?? "TrustDesk";
}

function linkClass(active: boolean) {
  return cn(
    "relative flex min-h-11 items-center gap-2 rounded-card px-3 text-sm",
    active ? "text-ink" : "text-muted hover:bg-raised hover:text-ink",
  );
}

export function Shell() {
  const user = currentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = useReducedMotion();
  const { theme, setTheme } = useTheme();
  const [more, setMore] = useState(false);
  if (!user) return null;
  const staff = user.role === "admin" || user.role === "supervisor";
  const ops = staff ? operations : [];
  const tenantLinks = user.role === "admin" ? tenant : [];
  const all = [...work, ...ops, ...tenantLinks];

  function signOut() {
    clearSession();
    navigate("/login");
  }

  return (
    <div className="grid h-dvh overflow-hidden md:grid-cols-[256px_1fr]">
      <aside className="hidden h-dvh overflow-hidden border-r border-line bg-surface md:flex md:flex-col">
        <div className="flex shrink-0 items-center gap-2 px-4 py-4">
          <span className="grid size-8 place-items-center rounded-card bg-accent-ink text-xs font-semibold text-white dark:bg-accent dark:text-[#0f1115]">TD</span>
          <div>
            <div className="text-sm font-semibold">TrustDesk</div>
            <div className="text-xs text-muted">{user.role}</div>
          </div>
        </div>
        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          <NavGroup title="Workbench" items={work} reduced={Boolean(reduced)} />
          {ops.length > 0 && <NavGroup title="Operations" items={ops} reduced={Boolean(reduced)} />}
          {tenantLinks.length > 0 && <NavGroup title="Tenant" items={tenantLinks} reduced={Boolean(reduced)} />}
        </nav>
        <div className="shrink-0 border-t border-line p-3">
          <div className="rounded-card bg-raised px-3 py-2 text-xs">
            <div className="font-medium text-ink">{user.name}</div>
            <div className="capitalize text-muted">{user.role}</div>
          </div>
        </div>
      </aside>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
        <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
          <div>
            <div className="text-sm font-semibold">{titles(location.pathname)}</div>
            <div className="text-xs capitalize text-muted md:hidden">{user.role}</div>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden text-xs capitalize text-muted md:inline">{user.role}</span>
            <ThemeMenu theme={theme} setTheme={setTheme} />
            <button type="button" className="min-h-11 rounded-card px-3 text-sm text-muted hover:bg-raised" onClick={signOut}>Sign out</button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5 md:px-6 md:pb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: 4 }}
              transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden">
        {work.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => cn(linkClass(isActive), "flex-1 justify-center")}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        {staff && (
          <button type="button" className="flex min-h-11 flex-1 items-center justify-center gap-1 text-sm text-muted" onClick={() => setMore(true)} aria-label="More sections">
            <Menu size={16} aria-hidden /> More
          </button>
        )}
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="Sections">
        {all.filter((item) => !work.some((row) => row.to === item.to)).map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)} onClick={() => setMore(false)}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </Sheet>
    </div>
  );
}

function NavGroup({ title, items, reduced }: { title: string; items: LinkItem[]; reduced: boolean }) {
  return (
    <div>
      <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted">{title}</p>
      <div className="grid gap-0.5">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
            {({ isActive }) => (
              <>
                {isActive && !reduced && <motion.span layoutId="nav-active" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent-ink" />}
                {isActive && reduced && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent-ink" />}
                {isActive && <span className="absolute inset-0 -z-10 rounded-card bg-raised" />}
                {item.icon}
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function ThemeMenu({ theme, setTheme }: { theme: string; setTheme: (theme: "system" | "light" | "dark") => void }) {
  const icon = theme === "dark" ? <Moon size={16} aria-hidden /> : theme === "light" ? <Sun size={16} aria-hidden /> : <Monitor size={16} aria-hidden />;
  return (
    <UserMenu label="Color theme" trigger={<span className="inline-flex items-center gap-2">{icon} Theme</span>}>
      <MenuItem onSelect={() => setTheme("system")}>System</MenuItem>
      <MenuItem onSelect={() => setTheme("light")}>Light</MenuItem>
      <MenuItem onSelect={() => setTheme("dark")}>Dark</MenuItem>
    </UserMenu>
  );
}
