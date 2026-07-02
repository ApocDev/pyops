import { HelpCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";

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
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          title={label}
          aria-label={label}
          className="text-muted-foreground"
        >
          <HelpCircle className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" aria-describedby={undefined} className="w-[32rem] max-w-[92vw]">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
