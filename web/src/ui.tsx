import type { ButtonHTMLAttributes } from "react";

// The FAS SDK UI has no button primitive; this one follows the shared design tokens.
const VARIANTS = {
  primary: "bg-accent text-[var(--on-accent)] hover:bg-accent-hover",
  secondary: "border border-line-strong bg-paper text-ink hover:bg-panel",
  ghost: "bg-transparent text-accent hover:bg-accent-soft",
  danger: "bg-danger text-[var(--on-accent)] hover:opacity-90",
};
export function Button({
  variant = "primary",
  loading = false,
  className = "",
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading ? "Working…" : children}
    </button>
  );
}
