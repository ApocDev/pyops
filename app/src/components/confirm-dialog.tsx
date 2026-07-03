import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog.tsx";

/**
 * The app's one destructive-action confirm (#83): a controlled AlertDialog
 * with the standard anatomy — title, body copy naming exactly what's being
 * destroyed, Cancel + a destructive confirm. Every "are you sure?" for a
 * dangerous action goes through this; small reversible deletes skip the
 * confirm entirely and rely on the undo toast instead.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Body copy — name the thing being deleted and what happens to it. */
  description: ReactNode;
  /** Label of the destructive confirm button (e.g. "Delete block"). */
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription className="p-3">{description}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
