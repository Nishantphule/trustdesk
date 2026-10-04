import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {detail && <p className="mt-1 max-w-2xl text-sm text-muted">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("min-w-0 break-words rounded-card border border-line bg-surface p-4 shadow-card", className)}>{children}</section>;
}

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-card md:block">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-raised text-left text-xs uppercase tracking-wide text-muted">{children}</thead>;
}

export function SplitPane({ list, editor }: { list: ReactNode; editor: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(16rem,22rem)_1fr] md:items-start">
      <div className="min-w-0">{list}</div>
      <div className="min-w-0">{editor}</div>
    </div>
  );
}

export function ListButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full min-h-11 gap-0.5 rounded-card px-3 py-2 text-left text-sm",
        active ? "bg-raised text-ink" : "text-ink hover:bg-raised",
      )}
    >
      {children}
    </button>
  );
}
