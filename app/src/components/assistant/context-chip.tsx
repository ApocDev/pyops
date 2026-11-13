import { X } from "lucide-react";

import { Icon } from "#/lib/icons";
import { dismissFocusedEntity, ENTITY_NOUN, type PageEntity } from "#/lib/page-context.ts";
import { Button } from "#/components/ui/button.tsx";

/** The dock composer's page-context chip: what the next message is about.
 * Removing it sends without the entity until the page focuses something else. */
export function ContextChip({ entity }: { entity: PageEntity }) {
  return (
    <div className="mb-1.5 flex">
      <span className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 border border-info/40 bg-info/10 pl-1.5 text-sm">
        {entity.icon && <Icon kind={entity.icon.kind} name={entity.icon.name} size="xs" noHover />}
        <span className="min-w-0 truncate">{entity.label}</span>
        <span className="text-muted-foreground">{ENTITY_NOUN[entity.kind]}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Remove page context"
          onClick={dismissFocusedEntity}
          className="text-muted-foreground hover:text-foreground"
        >
          <X />
        </Button>
      </span>
    </div>
  );
}
