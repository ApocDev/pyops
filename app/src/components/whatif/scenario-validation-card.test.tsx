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
