import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Menu, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearSession, currentUser } from "@/api";
import { Menu as UserMenu, MenuItem, Sheet } from "@/components/ui/overlays";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";

const work = [
  { to: "/queue", label: "Queue" },
  { to: "/eval", label: "Eval" },
];

const adminLinks = [
  { to: "/admin/org", label: "Org" },
  { to: "/admin/modules", label: "Modules" },
  { to: "/admin/policies", label: "Policies" },
  { to: "/admin/mailboxes", label: "Mailboxes" },
  { to: "/admin/tools", label: "Tools" },
  { to: "/admin/rules", label: "Rules" },
  { to: "/admin/people", label: "People" },
  { to: "/admin/traces", label: "Traces" },
  { to: "/admin/tenant", label: "Tenant", adminOnly: true },
];

function linkClass(active: boolean) {
  return cn("flex min-h-11 items-center rounded-md px-3 text-sm", active ? "bg-raised text-ink" : "text-muted");
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
  const links = [...work, ...(staff ? adminLinks.filter((item) => !item.adminOnly || user.role === "admin") : [])];

  function signOut() {
    clearSession();
    navigate("/login");
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-line bg-surface p-3 md:flex md:flex-col md:gap-1">
        <div className="px-3 py-2 text-lg font-semibold">TrustDesk</div>
        <p className="px-3 pb-2 text-xs text-muted">{user.name}<br />{user.role}</p>
        {links.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>{item.label}</NavLink>
        ))}
        <div className="mt-auto flex items-center justify-between px-1">
          <ThemeMenu theme={theme} setTheme={setTheme} />
          <button type="button" className="min-h-11 px-3 text-sm text-muted" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-3 md:hidden">
          <span className="text-base font-semibold">TrustDesk</span>
          <div className="flex items-center">
            <ThemeMenu theme={theme} setTheme={setTheme} />
            <button type="button" className="min-h-11 px-3 text-sm text-muted" onClick={signOut}>Sign out</button>
          </div>
        </header>
        <main className="flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduced ? undefined : { opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden">
        {work.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => cn(linkClass(isActive), "flex-1 justify-center")}>{item.label}</NavLink>
        ))}
        {staff && (
          <button type="button" className="flex min-h-11 flex-1 items-center justify-center gap-1 text-sm text-muted" onClick={() => setMore(true)} aria-label="More sections">
            <Menu size={16} aria-hidden /> More
          </button>
        )}
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="Sections">
        {links.filter((item) => !work.some((row) => row.to === item.to)).map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)} onClick={() => setMore(false)}>{item.label}</NavLink>
        ))}
      </Sheet>
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
