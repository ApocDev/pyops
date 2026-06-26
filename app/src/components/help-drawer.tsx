import { HelpCircle, X } from "lucide-react";
import { useState, type ReactNode } from "react";

/** A small `?` button that opens a right-side documentation drawer. Reusable across
 * views to explain "what is this / why does it exist" without a wall of inline text.
 * Pass the long-form docs as children. */
export function HelpButton({
  title,
  children,
  label = "What is this?",
}: {
  title: string;
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className="flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <HelpCircle className="size-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-[32rem] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="font-semibold">{title}</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-auto p-4 text-sm leading-relaxed text-muted-foreground">
              {children}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
