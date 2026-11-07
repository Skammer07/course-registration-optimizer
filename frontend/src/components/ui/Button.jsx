import { cn } from "./cn.js";
import { Icon } from "./Icon.jsx";
import { Spinner } from "./Spinner.jsx";

const VARIANTS = {
  primary: "bg-accent text-white hover:bg-accent-hover shadow-card",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-wash",
  ghost: "text-ink-2 hover:bg-wash hover:text-ink",
  danger: "bg-critical-ink text-white hover:bg-[#8f1f1f] shadow-card",
};
const SIZES = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

/** Class string so links (<Link>) can look like buttons. */
export function buttonClass({ variant = "secondary", size = "md", className } = {}) {
  return cn(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className
  );
}

export function Button({ variant, size, loading = false, icon, className, children, disabled, type = "button", ...props }) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}
