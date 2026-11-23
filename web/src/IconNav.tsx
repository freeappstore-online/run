import type { MouseEvent, ReactNode } from "react";

export function NavigationIcon({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}
export const ICONS = {
  record: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-2 5 6 4-6 4V8Z",
  plan: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  history: "M3 12a9 9 0 1 0 3-6.7M3 3v6h6m3-2v5l3 2",
};

function follow(event: MouseEvent<HTMLAnchorElement>, href: string, navigate: (href: string) => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}

/**
 * Mobile-first main navigation: icons are always visible (labels from 640px up), no menu button.
 * The store's shell keeps routing, titles and focus; Profile stays on the avatar.
 */
export function IconNavigation({
  items,
  currentPath,
  onNavigate,
  activity,
}: {
  items: { label: string; href: string; icon?: ReactNode }[];
  currentPath: string;
  onNavigate: (href: string) => void;
  /** A dot on one item, e.g. while a run is recording. */
  activity?: { href: string; label: string };
}) {
  return (
    <nav aria-label="Main" className="flex min-w-0 flex-1">
      <ul className="m-0 flex w-full list-none items-center justify-evenly gap-1 p-0 sm:justify-start">
        {items
          .filter((item) => item.href !== "/profile")
          .map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                title={item.label}
                aria-current={currentPath === item.href ? "page" : undefined}
                onClick={(event) => follow(event, item.href, onNavigate)}
                className="relative flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[10px] text-sm font-semibold text-[var(--muted)] no-underline aria-[current=page]:bg-[var(--line)] aria-[current=page]:text-[var(--accent)] sm:px-3"
              >
                {item.icon ?? <NavigationIcon path="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />}
                <span className="sr-only sm:not-sr-only">{item.label}</span>
                {activity?.href === item.href && (
                  <span role="img" aria-label={activity.label} className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--danger)]" />
                )}
              </a>
            </li>
          ))}
      </ul>
    </nav>
  );
}
