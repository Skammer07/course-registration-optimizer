import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { cn } from "../ui/cn.js";
import { Icon, Logo } from "../ui/Icon.jsx";
import { Badge } from "../ui/Badge.jsx";

/**
 * Sidebar entries per role. `match` decides when an entry counts as the current page;
 * `section` groups entries under a small heading.
 */
export function navFor(role) {
  if (role === "student") {
    return [
      { to: "/my-results", label: "My results", icon: "list", match: (p) => p.startsWith("/my-results") },
      { to: "/my-preferences", label: "My preferences", icon: "edit", match: (p) => p.startsWith("/my-preferences") },
    ];
  }
  const items = [
    { section: "Allocation", to: "/runs", label: "Allocation runs", icon: "history", match: (p) => p.startsWith("/runs") && p !== "/runs/new" },
  ];
  if (role === "admin") {
    items.push({ section: "Allocation", to: "/runs/new", label: "New run", icon: "play", match: (p) => p === "/runs/new" });
  }
  items.push(
    { section: "Data", to: "/data/courses", label: "Courses", icon: "book", match: (p) => p.startsWith("/data/courses") },
    { section: "Data", to: "/data/students", label: "Students", icon: "user", match: (p) => p.startsWith("/data/students") }
  );
  if (role === "admin") {
    items.push({ section: "Data", to: "/data/import", label: "Import data", icon: "upload", match: (p) => p.startsWith("/data/import") });
  }
  return items;
}

const ROLE_LABEL = { admin: "Admin", faculty: "Faculty", student: "Student" };

function NavList({ items, pathname }) {
  // keep the order, start a new group whenever the section changes
  const groups = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {groups.map((group, index) => (
        <div key={group.section ?? index} className="flex flex-col gap-1">
          {group.section ? <p className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-3">{group.section}</p> : null}
          {group.items.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent-soft text-accent-ink before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-accent"
                    : "text-ink-2 hover:bg-wash hover:text-ink"
                )}
              >
                <Icon name={item.icon} className="size-4.5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Account({ user, onLogout }) {
  return (
    <div className="border-t border-line p-3">
      <div className="mb-2 flex items-center gap-3 rounded-lg bg-wash/70 px-3 py-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
          <Icon name="user" className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink" title={user.email}>{user.email}</p>
          <Badge className="mt-0.5">{ROLE_LABEL[user.role] ?? user.role}</Badge>
        </div>
      </div>
      <Link to="/change-password" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-wash hover:text-ink">
        <Icon name="shield" className="size-4.5" />
        Change password
      </Link>
      <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-wash hover:text-ink">
        <Icon name="logout" className="size-4.5" />
        Sign out
      </button>
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);
  const items = navFor(user.role);

  useEffect(() => setDrawer(false), [pathname]);

  // the route guard sends a signed-out user to the sign-in page
  const signOut = () => logout();

  const brand = (
    <Link to="/" className="flex items-center gap-2.5 px-1">
      <Logo />
      <span className="text-[0.95rem] font-semibold leading-tight text-ink">
        Course Allocation
        <span className="block text-xs font-normal text-ink-3">Prototype</span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-[var(--shadow-pop)]">
        Skip to content
      </a>

      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="px-4 py-5">{brand}</div>
        <div className="flex-1 px-3">
          <NavList items={items} pathname={pathname} />
        </div>
        <Account user={user} onLogout={signOut} />
      </aside>

      {/* mobile top bar + drawer */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        {brand}
        <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded-lg p-2 text-ink-2 hover:bg-wash">
          <Icon name="menu" className="size-5" />
        </button>
      </div>
      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-[var(--shadow-pop)]">
            <div className="flex items-center justify-between px-4 py-4">
              {brand}
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-lg p-2 text-ink-2 hover:bg-wash">
                <Icon name="x" className="size-5" />
              </button>
            </div>
            <div className="flex-1 px-3">
              <NavList items={items} pathname={pathname} />
            </div>
            <Account user={user} onLogout={signOut} />
          </div>
        </div>
      ) : null}

      <main id="main" className="min-w-0">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
