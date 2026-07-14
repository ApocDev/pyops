import { ArrowDown, ArrowUp, Minus } from "lucide-react";

const sectionClass = "border-t border-border pt-2";
const summaryClass = "cursor-pointer text-sm font-semibold text-foreground";

export function BlockHelpContent() {
  return (
    <div className="space-y-3">
      <p>
        A block is one production unit: choose its goals and recipes, then PyOps calculates the
        buildings and boundary flows.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Add one or more goal goods and set their rates.</li>
        <li>Add the recipes that make them.</li>
        <li>Review imports, exports, buildings, and any solve warnings.</li>
      </ol>

      <details className={sectionClass}>
        <summary className={summaryClass}>Goals and rates</summary>
        <div className="mt-2 space-y-2">
          <p>
            Each goal is a minimum output rate. Click its rate to edit it and its unit to cycle
            between /s, /min, and /h. The first goal names the block and anchors factory scaling.
          </p>
          <p>
            Right-click a goal to keep a quantity in stock instead of treating it as continuous
            throughput. Extra output beyond a goal becomes an export.
          </p>
        </div>
      </details>

      <details className={sectionClass}>
        <summary className={summaryClass}>Supply priority</summary>
        <div className="mt-2 space-y-2">
          <p className="flex items-center gap-2">
            <ArrowUp className="size-4 text-success" /> Preferred suppliers are used first.
          </p>
          <p className="flex items-center gap-2">
            <Minus className="size-4 text-muted-foreground" /> Normal suppliers follow.
          </p>
          <p className="flex items-center gap-2">
            <ArrowDown className="size-4 text-warning" /> Fallback suppliers fill what remains.
          </p>
          <p>
            Priority chooses between blocks supplying the same good. It never scales a block solely
            to manufacture an incidental byproduct. Advanced mode allows numeric tiers and
            per-export overrides; exports inherit the block priority by default.
          </p>
        </div>
      </details>

      <details className={sectionClass}>
        <summary className={summaryClass}>How solving works</summary>
        <div className="mt-2 space-y-2">
          <p>
            You choose the recipes and constraints. PyOps finds the lowest machine-time rates that
            satisfy them, including cyclic chains. Marking a good made here prevents importing it;
            unmarked consumption may cross the block boundary as an import.
          </p>
          <p>
            An infeasible result means the selected goals, marks, or pins conflict. The balance card
            identifies the conflict and offers relevant fixes.
          </p>
        </div>
      </details>

      <details className={sectionClass}>
        <summary className={summaryClass}>Spoilage</summary>
        <p className="mt-2">
          Stopwatch markers identify spoilable products. Incidental spoilage estimates add the spoil
          result to exports without changing the nominal recipe solve. For demand-driven spoilage,
          add the actual spoiling recipe and make its result a goal.
        </p>
      </details>

      <details className={sectionClass}>
        <summary className={summaryClass}>Sub-blocks and toolbar</summary>
        <div className="mt-2 space-y-2">
          <p>
            Right-click a recipe name to group related rows into a collapsible sub-block. Grouping
            changes presentation unless you explicitly promote it to a separately solved module.
            Drag another recipe onto the sub-block header or any of its indented rows to add it.
          </p>
          <p>
            The toolbar provides copy, share-file export, snapshots, in-game display, construction
            cost, and block enable/disable controls.
          </p>
        </div>
      </details>
    </div>
  );
}
