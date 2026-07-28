"use client";

import type { ReactNode } from "react";
import { Button, Card, cx } from "@/components/ui";
import type { SettingsIssue } from "@/lib/domain/settings-validation";

/**
 * Pieces shared by every Settings tab (M1 §4.2). Kept deliberately plain: the
 * manager is a restaurant owner, not an admin — every control carries a
 * one-line "what this means" rather than jargon.
 */

// ---------------------------------------------------------------------------
// Async states — CLAUDE.md rule 6: loading + error with retry, everywhere
// ---------------------------------------------------------------------------

export function LoadingPanel({ label = "Loading…" }: { label?: string }) {
  return (
    <Card className="p-10 text-center text-sm text-ink-faint" >
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 animate-pulse rounded-full bg-ink-faint/50" />
        {label}
      </span>
    </Card>
  );
}

export function ErrorPanel({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <Card className="p-6 text-center">
      <p className="text-sm text-clay">{message}</p>
      <Button variant="outline" className="mt-4 h-11" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </Card>
  );
}

/** Inline failure notice for a write that did not land. */
export function WriteError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-clay/30 bg-clay/5 px-4 py-3 text-[13px] text-clay"
    >
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 font-semibold underline underline-offset-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation issues (M1 §6)
// ---------------------------------------------------------------------------

export function IssueList({ issues, className }: { issues: SettingsIssue[]; className?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className={cx("space-y-2", className)} role="alert">
      {issues.map((issue, i) => (
        <li
          key={`${issue.code}:${i}`}
          className={cx(
            "rounded-xl border px-4 py-2.5 text-[13px]",
            issue.severity === "error"
              ? "border-clay/30 bg-clay/5 text-clay"
              : "border-saffron/40 bg-saffron-soft/50 text-[#8a6212]",
          )}
        >
          <span className="font-semibold">
            {issue.severity === "error" ? "Fix this: " : "Heads up: "}
          </span>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Layout + controls
// ---------------------------------------------------------------------------

export function SectionCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="font-display text-lg font-semibold leading-tight text-ink">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-ink-soft">{description}</p>}
      </div>
      <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface-2 px-5 py-4 sm:px-6">
          {footer}
        </div>
      )}
    </Card>
  );
}

/** One setting: its control, and the plain-English sentence explaining it. */
export function SettingRow({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string;
  help: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  // A <label> is only correct when it points at a real control; controls that
  // carry their own accessible name (the Toggle, the chip groups) get a <span>.
  const Heading = htmlFor ? "label" : "span";
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-start sm:gap-6">
      <div>
        <Heading htmlFor={htmlFor} className="block text-sm font-semibold text-ink">
          {label}
        </Heading>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{help}</p>
      </div>
      <div className="sm:justify-self-end sm:w-[260px]">{children}</div>
    </div>
  );
}

/** Accessible on/off switch with a 44px tap target. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name — visually the SettingRow label usually carries it. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "inline-flex min-h-11 items-center gap-3 rounded-xl px-1 text-[13px] font-medium transition disabled:opacity-40",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span
        className={cx(
          "relative h-6 w-11 shrink-0 rounded-full transition",
          checked ? "bg-ember" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </span>
      <span className={checked ? "text-ink" : "text-ink-faint"}>{checked ? "On" : "Off"}</span>
    </button>
  );
}

/** A saved-successfully flash next to the save button. */
export function SavedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-[13px] font-medium text-herb">Saved</span>;
}
