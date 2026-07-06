/**
 * researchPath tool (#125): prerequisite closure and science cost to unlock a
 * target — a technology, a recipe, or an item/fluid good (resolved in that
 * priority). Fixture: a plain 3-tech chain (t-root <- t-mid <- t-leaf, t-leaf
 * unlocking circuit-basic) plus a TURD master (master-x) with one sub-tech
 * (branch-a, gated by turd-select-branch-a) unlocking a second producer of the
 * same good (circuit-turd) — so both the ordering/cost math and the TURD-gate
 * surfacing can be exercised in one db.
 */
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, switchDatabase } from "../db/index.server.ts";
import { setResearchHorizon, setTurdSelection } from "../db/queries.server.ts";
import { type TestDb, makeTestDb } from "../db/test-helpers.ts";
import { researchPath } from "./agent-tools.server.ts";

type Result = {
  ok: boolean;
  target?: string;
  kind?: string;
  display?: string;
  error?: string;
  alreadyUnlocked?: boolean;
  note?: string;
  targetTech?: string;
  targetTechDisplay?: string;
  alternateRoutes?: { tech: string; display: string }[];
  steps?: { tech: string; display: string; cost: string }[];
  stepsOmitted?: number;
  totalCost?: string;
  turdGatesNeeded?: {
    subTech: string;
    subTechDisplay: string;
    master: string | null;
    masterDisplay: string | null;
    state: "pickable" | "blocked";
  }[];
};

const run = async (target: string, limit = 40): Promise<Result> =>
  (await researchPath.execute!({ target, limit }, { toolCallId: "test", messages: [] })) as Result;

describe("researchPath", () => {
  let fx: TestDb;

  beforeEach(async () => {
    fx = await makeTestDb();
    fx.db.exec(`
      INSERT INTO items (name, display) VALUES
        ('automation-science-pack','Automation science pack'),
        ('py-science-pack-1','Py science pack 1'),
        ('circuit','Circuit'),
        ('no-recipe-item','No recipe item');

      INSERT INTO recipes (name, kind, hidden, enabled) VALUES
        ('circuit-basic','real',0,0),
        ('circuit-turd','real',0,0),
        ('circuit-always','real',0,1);
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('circuit-basic',0,'item','circuit',1),
        ('circuit-turd',0,'item','circuit',1),
        ('circuit-always',0,'item','circuit',1);

      -- plain chain: t-root <- t-mid <- t-leaf (t-leaf unlocks circuit-basic)
      INSERT INTO technologies (name, display) VALUES
        ('t-root','Root'),('t-mid','Mid'),('t-leaf','Leaf');
      INSERT INTO tech_prerequisites (technology, prerequisite) VALUES
        ('t-mid','t-root'),
        ('t-leaf','t-mid');
      INSERT INTO tech_ingredients (technology, name, amount) VALUES
        ('t-root','automation-science-pack',10),
        ('t-mid','automation-science-pack',20),
        ('t-mid','py-science-pack-1',5),
        ('t-leaf','py-science-pack-1',15);
      INSERT INTO tech_unlocks (technology, recipe) VALUES ('t-leaf','circuit-basic');

      -- TURD master with one sub-tech gating circuit-turd
      INSERT INTO technologies (name, display, is_turd) VALUES ('master-x','Master X',1);
      INSERT INTO technologies (name, display) VALUES
        ('branch-a','Branch A'),
        ('turd-select-branch-a','Select Branch A');
      INSERT INTO tech_ingredients (technology, name, amount) VALUES
        ('master-x','automation-science-pack',10);
      INSERT INTO tech_prerequisites (technology, prerequisite) VALUES
        ('branch-a','master-x'),
        ('branch-a','turd-select-branch-a');
      INSERT INTO tech_unlocks (technology, recipe) VALUES ('branch-a','circuit-turd');
    `);
    fx.db.close();
    switchDatabase(fx.file);
  });

  afterEach(() => fx.cleanup());

  it("orders a plain tech chain prereqs-first, with per-step and total cost", async () => {
    const r = await run("t-leaf");
    expect(r.ok).toBe(true);
    expect(r.steps?.map((s) => s.tech)).toEqual(["t-root", "t-mid", "t-leaf"]);
    const mid = r.steps?.find((s) => s.tech === "t-mid");
    expect(mid?.cost).toBe("20 automation-science-pack + 5 py-science-pack-1");
    expect(r.totalCost).toBe("30 automation-science-pack + 20 py-science-pack-1");
  });

  it("prunes an already-researched prerequisite's subtree", async () => {
    setResearchHorizon({ researched: ["t-root"] });
    const r = await run("t-leaf");
    expect(r.steps?.map((s) => s.tech)).toEqual(["t-mid", "t-leaf"]);
    expect(r.totalCost).toBe("20 automation-science-pack + 20 py-science-pack-1");
  });

  it("resolves a disabled recipe target to its single unlocking tech", async () => {
    const r = await run("circuit-basic");
    expect(r.kind).toBe("recipe");
    expect(r.targetTech).toBe("t-leaf");
    expect(r.steps?.map((s) => s.tech)).toEqual(["t-root", "t-mid", "t-leaf"]);
    expect(r.alternateRoutes).toBeUndefined();
  });

  it("reports alreadyUnlocked for a start-enabled recipe", async () => {
    const r = await run("circuit-always");
    expect(r.ok).toBe(true);
    expect(r.alreadyUnlocked).toBe(true);
    expect(r.steps).toBeUndefined();
  });

  it("resolves a good target with an enabled producer as alreadyUnlocked", async () => {
    // circuit is produced by circuit-always (enabled) alongside the two gated
    // recipes, so the good itself already has a working route.
    const r = await run("circuit");
    expect(r.kind).toBe("good");
    expect(r.alreadyUnlocked).toBe(true);
  });

  it("resolves a good with no enabled producer via ranked unlocking techs, keeping the other route visible", async () => {
    // a second good produced only by the two gated recipes (no enabled one),
    // to exercise the ranking + alternateRoutes path.
    db.run(sql`INSERT INTO items (name, display) VALUES ('gated-circuit','Gated circuit')`);
    db.run(sql`
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('circuit-basic',1,'item','gated-circuit',1),
        ('circuit-turd',1,'item','gated-circuit',1)
    `);
    const r = await run("gated-circuit");
    expect(r.ok).toBe(true);
    expect(r.alreadyUnlocked).toBeFalsy();
    expect(r.targetTech).toBeDefined();
    const allTechs = [r.targetTech, ...(r.alternateRoutes?.map((a) => a.tech) ?? [])];
    expect(allTechs).toContain("t-leaf");
    expect(allTechs).toContain("branch-a");
  });

  it("surfaces a TURD gate separately from the step list, as pickable when undecided", async () => {
    const r = await run("circuit-turd");
    expect(r.targetTech).toBe("branch-a");
    expect(r.steps?.map((s) => s.tech)).toEqual(["master-x", "branch-a"]);
    expect(r.steps?.every((s) => !s.tech.startsWith("turd-select-"))).toBe(true);
    expect(r.turdGatesNeeded).toEqual([
      {
        subTech: "branch-a",
        subTechDisplay: "Branch A",
        master: "master-x",
        masterDisplay: "Master X",
        state: "pickable",
      },
    ]);
  });

  it("drops the TURD gate once that branch is already selected", async () => {
    setTurdSelection("master-x", "branch-a");
    const r = await run("circuit-turd");
    expect(r.turdGatesNeeded).toBeUndefined();
  });

  it("reports the TURD gate as blocked when a different branch is selected", async () => {
    db.run(sql`
      INSERT INTO technologies (name, display) VALUES
        ('branch-b','Branch B'),
        ('turd-select-branch-b','Select Branch B')
    `);
    db.run(sql`
      INSERT INTO tech_prerequisites (technology, prerequisite) VALUES
        ('branch-b','master-x'),
        ('branch-b','turd-select-branch-b')
    `);
    setTurdSelection("master-x", "branch-b");
    const r = await run("circuit-turd");
    expect(r.turdGatesNeeded?.[0]?.state).toBe("blocked");
  });

  it("errors on an unknown target", async () => {
    const r = await run("no-such-thing");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no-such-thing");
  });

  it("reports a raw good with no producing recipe as no-tech-to-research, not an error", async () => {
    const r = await run("no-recipe-item");
    expect(r.ok).toBe(true);
    expect(r.alreadyUnlocked).toBe(false);
    expect(r.targetTech).toBeUndefined();
    expect(r.note).toContain("no tech unlocks this");
  });

  it("reports a technology target as alreadyUnlocked once it's synced-researched (#129)", async () => {
    setResearchHorizon({ researched: ["t-root"] });
    const r = await run("t-root");
    expect(r.ok).toBe(true);
    expect(r.alreadyUnlocked).toBe(true);
    expect(r.steps).toBeUndefined();
  });

  it("reports a start-disabled recipe as alreadyUnlocked once its unlocking tech is synced-researched (#129)", async () => {
    // circuit-basic's enabled column stays false (a real save doesn't rewrite
    // that static column) even though t-leaf has actually been researched.
    setResearchHorizon({ researched: ["t-root", "t-mid", "t-leaf"] });
    const r = await run("circuit-basic");
    expect(r.ok).toBe(true);
    expect(r.alreadyUnlocked).toBe(true);
    expect(r.steps).toBeUndefined();
  });

  it("reports a good as alreadyUnlocked once its only unlocking tech is synced-researched (#129)", async () => {
    db.run(sql`INSERT INTO items (name, display) VALUES ('gated-circuit','Gated circuit')`);
    db.run(sql`
      INSERT INTO recipe_products (recipe, idx, kind, name, amount) VALUES
        ('circuit-basic',1,'item','gated-circuit',1)
    `);
    setResearchHorizon({ researched: ["t-root", "t-mid", "t-leaf"] });
    const r = await run("gated-circuit");
    expect(r.ok).toBe(true);
    expect(r.alreadyUnlocked).toBe(true);
    expect(r.steps).toBeUndefined();
  });

  it("truncates a deep path to `limit`, keeping the steps closest to the target", async () => {
    const r = await run("t-leaf", 2);
    expect(r.steps?.map((s) => s.tech)).toEqual(["t-mid", "t-leaf"]);
    expect(r.stepsOmitted).toBe(1);
    // totalCost still sums the WHOLE path, not just the shown steps
    expect(r.totalCost).toBe("30 automation-science-pack + 20 py-science-pack-1");
  });

  it("omits stepsOmitted when the path fits within `limit`", async () => {
    const r = await run("t-leaf", 40);
    expect(r.steps).toHaveLength(3);
    expect(r.stepsOmitted).toBeUndefined();
  });
});
