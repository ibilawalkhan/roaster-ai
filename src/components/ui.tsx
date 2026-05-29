"use client";

import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { accentOf, initials } from "@/lib/utils";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------- Button ----------

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ember text-white hover:bg-ember-deep shadow-[0_2px_0_var(--color-ember-deep)] active:translate-y-px active:shadow-none",
  secondary: "bg-charcoal text-paper hover:bg-charcoal-2",
  outline:
    "border border-line-strong bg-surface text-ink hover:bg-surface-2 hover:border-ink-faint",
  ghost: "text-ink-soft hover:bg-paper-deep hover:text-ink",
  danger: "border border-clay/40 text-clay hover:bg-clay/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[11px]",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: { variant?: Variant; size?: Size } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center font-medium tracking-tight transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Card ----------

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-card border border-line bg-surface shadow-soft",
        className
      )}
    >
      {children}
    </div>
  );
}

// ---------- Badge ----------

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "ember" | "herb" | "saffron" | "clay" | "muted";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-paper-deep text-ink-soft",
    ember: "bg-ember-soft text-ember-deep",
    herb: "bg-herb-soft text-herb",
    saffron: "bg-saffron-soft text-[#8a6212]",
    clay: "bg-[#f3dcd3] text-[#8a3418]",
    muted: "bg-transparent text-ink-faint border border-line",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ---------- Avatar ----------

export function Avatar({
  name,
  accent,
  size = 36,
}: {
  name: string;
  accent: string;
  size?: number;
}) {
  const a = accentOf(accent);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        backgroundColor: a.bg,
        color: a.text,
        fontSize: size * 0.38,
        border: `1px solid ${a.border}`,
      }}
    >
      {initials(name)}
    </span>
  );
}

// ---------- StatCard ----------

export function StatCard({
  label,
  value,
  sub,
  accent = "ember",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  icon?: ReactNode;
}) {
  const a = accentOf(accent);
  return (
    <Card className="relative overflow-hidden p-5">
      <div
        className="absolute right-0 top-0 h-20 w-20 -translate-y-6 translate-x-6 rounded-full opacity-50 blur-2xl"
        style={{ backgroundColor: a.bg }}
      />
      <div className="relative flex items-start justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
          {label}
        </p>
        {icon && (
          <span style={{ color: a.dot }} className="opacity-80">
            {icon}
          </span>
        )}
      </div>
      <p className="nums relative mt-2 font-display text-3xl font-semibold leading-none text-ink">
        {value}
      </p>
      {sub && <p className="relative mt-1.5 text-sm text-ink-soft">{sub}</p>}
    </Card>
  );
}

// ---------- Form fields ----------

export function Label({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-ink-soft"
    >
      {children}
    </label>
  );
}

const fieldBase =
  "w-full rounded-[11px] border border-line-strong bg-surface px-3.5 text-sm text-ink placeholder:text-ink-faint outline-none transition focus:border-ember focus:ring-4 focus:ring-ember/15";

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldBase, "h-11", className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cx(fieldBase, "py-2.5 min-h-20 resize-y", className)} {...rest} />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cx(fieldBase, "h-11 appearance-none pr-9", className)}
        {...rest}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

// ---------- Modal ----------

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="overlay-in absolute inset-0 bg-charcoal/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="pop-in relative m-0 w-full rounded-t-2xl border border-line bg-surface shadow-pop sm:m-4 sm:rounded-2xl"
        style={{ maxWidth }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 className="font-display text-xl font-semibold leading-tight text-ink">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition hover:bg-paper-deep hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-6 py-4 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export { cx };
