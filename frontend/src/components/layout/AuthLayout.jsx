import { Logo } from "../ui/Icon.jsx";

/** Centered card used by the sign-in and change-password pages. */
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Logo className="size-10" />
          <div className="leading-tight">
            <p className="text-lg font-semibold text-ink">Course Allocation</p>
            <p className="text-xs text-ink-3">Elective registration prototype</p>
          </div>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-3">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-center text-sm text-ink-3">{footer}</div> : null}
      </div>
    </div>
  );
}
