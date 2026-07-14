// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { ScenarioValidationCard } from "./scenario-validation-card.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(cleanup);

it("shows the affected block, solver detail, and proposed goals", () => {
  const view = render(
    <ScenarioValidationCard
      status="ValidationFailed"
      validation={{
        materialConflicts: [],
        blocks: [
          {
            id: 83,
            name: "Coal gas",
            status: "infeasible",
            message: "No rates satisfy the proposed goals.",
            goals: [
              { good: "coke", display: "Coke", rate: 11.1808 },
              { good: "coal-gas", display: "Coal gas", rate: 0 },
            ],
            unmade: [],
          },
        ],
        discrepancies: [],
        unstableGoals: [],
      }}
    />,
  );

  expect(view.getByText("Scenario validation failed")).not.toBeNull();
  expect(view.getByRole("link", { name: "Coal gas" })).not.toBeNull();
  expect(view.getByText("block solve: infeasible")).not.toBeNull();
  expect(view.getByText("Solver detail: No rates satisfy the proposed goals.")).not.toBeNull();
  expect(view.getByText("11.18/s")).not.toBeNull();
});

it("shows the material shortage and the blocks causing it", () => {
  const view = render(
    <ScenarioValidationCard
      status="Infeasible"
      validation={{
        materialConflicts: [
          {
            good: "creosote",
            display: "Creosote",
            direction: "shortage",
            amount: 30.27,
            required: 70.37,
            available: 40.1,
            blocks: [
              {
                id: 67,
                name: "Simple circuit board",
                supplied: 0,
                consumed: 70.37,
                configuredProducer: false,
                scalableProducer: false,
              },
              {
                id: 83,
                name: "Coal gas",
                supplied: 40.1,
                consumed: 0,
                configuredProducer: true,
                scalableProducer: false,
              },
            ],
          },
        ],
        blocks: [],
        discrepancies: [],
        unstableGoals: [],
      }}
    />,
  );

  expect(view.getByText("Creosote shortage: 30.27/s")).not.toBeNull();
  expect(view.getByText("70.37/s required · 40.1/s available")).not.toBeNull();
  expect(view.getByRole("link", { name: "Simple circuit board" })).not.toBeNull();
  expect(
    view.getByText("The configured Creosote goal has no additional scalable output."),
  ).not.toBeNull();
});
