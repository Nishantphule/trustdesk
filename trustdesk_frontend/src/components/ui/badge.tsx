import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

const tones: Record<string, string> = {
  neutral: "bg-raised text-ink",
  low: "bg-raised text-muted",
  medium: "bg-caution-bg text-caution",
  high: "bg-urgent-bg text-urgent",
  urgent: "bg-urgent-bg text-urgent",
  danger: "bg-danger-bg text-danger",
  safe: "bg-safe-bg text-safe",
  stale: "bg-stale-bg text-stale",
  escalated: "bg-danger-bg text-danger",
};

export function Badge({ tone = "neutral", children, className }: { tone?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", tones[tone] ?? tones.neutral, className)}>
      {children}
    </span>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs text-muted">{children}</span>;
}
