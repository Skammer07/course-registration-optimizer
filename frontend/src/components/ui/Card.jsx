import { cn } from "./cn.js";

export function Card({ as: Tag = "section", className, children, ...props }) {
  return (
    <Tag className={cn("rounded-card border border-line bg-surface shadow-card", className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, actions, className }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}
