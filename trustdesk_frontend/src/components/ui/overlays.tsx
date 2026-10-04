import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(100%,20rem)] flex-col gap-2 border-r border-line bg-surface p-4 shadow-card" aria-describedby={undefined}>
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">Choose a section. Focus stays inside this panel until you close it.</Dialog.Description>
          {children}
          <Dialog.Close className="mt-auto min-h-11 text-left text-sm text-muted">Close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Menu({ trigger, label, children }: { trigger: ReactNode; label: string; children: ReactNode }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button type="button" aria-label={label} className="min-h-11 min-w-11 rounded-md px-2 text-left text-sm">
          {trigger}
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="z-50 min-w-44 rounded-card border border-line bg-surface p-1 text-sm shadow-card" sideOffset={6}>
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function MenuItem({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <Dropdown.Item className="min-h-11 cursor-pointer rounded px-3 py-2 outline-none data-[highlighted]:bg-raised" onSelect={onSelect}>
      {children}
    </Dropdown.Item>
  );
}

export function InfoPopover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="z-50 w-72 rounded-card border border-line bg-surface p-3 text-sm shadow-card" sideOffset={6}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export const Tabs = TabsPrimitive.Root;
export const TabsList = ({ children }: { children: ReactNode }) => (
  <TabsPrimitive.List className="flex gap-1 overflow-x-auto border-b border-line">{children}</TabsPrimitive.List>
);
export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger value={value} className="min-h-11 px-3 text-sm text-muted data-[state=active]:border-b-2 data-[state=active]:border-accent-ink data-[state=active]:text-ink">
      {children}
    </TabsPrimitive.Trigger>
  );
}
export const TabsContent = ({ value, children, className }: { value: string; children: ReactNode; className?: string }) => (
  <TabsPrimitive.Content value={value} className={cn("pt-4", className)}>{children}</TabsPrimitive.Content>
);

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="z-50 rounded bg-ink px-2 py-1 text-xs text-bg" sideOffset={4}>
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
