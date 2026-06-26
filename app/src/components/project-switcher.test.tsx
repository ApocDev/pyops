// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ProjectSwitcher } from "./project-switcher.tsx";

const { listProjects, setActive, createProject, removeProject } = vi.hoisted(() => ({
  listProjects: vi.fn(),
  setActive: vi.fn(),
  createProject: vi.fn(),
  removeProject: vi.fn(),
}));
vi.mock("../server/factorio", () => ({
  listProjectsFn: listProjects,
  setActiveProjectFn: setActive,
  createProjectFn: createProject,
  removeProjectFn: removeProject,
}));

const PROJECTS = {
  active: "default",
  projects: [
    { id: "default", name: "Default" },
    { id: "py", name: "Py Run" },
  ],
};

let location: { reload: ReturnType<typeof vi.fn>; assign: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  listProjects.mockResolvedValue(PROJECTS);
  setActive.mockResolvedValue(undefined);
  createProject.mockResolvedValue(undefined);
  // jsdom's window.location can't be navigated; replace it with spies
  location = { reload: vi.fn(), assign: vi.fn() };
  Object.defineProperty(window, "location", { value: location, writable: true });
});
afterEach(cleanup);

describe("ProjectSwitcher", () => {
  it("labels the trigger with the active project", async () => {
    const { findByTitle } = render(<ProjectSwitcher />);
    expect(await findByTitle(/project: Default/)).toBeTruthy();
  });

  it("opens a dropdown listing every project plus a create action", async () => {
    const { findByTitle, getByText } = render(<ProjectSwitcher />);
    fireEvent.click(await findByTitle(/project: Default/));
    expect(getByText("Py Run")).toBeTruthy();
    expect(getByText("+ new project…")).toBeTruthy();
  });

  it("switches project then reloads (queries belong to the old db)", async () => {
    const { findByTitle, getByText } = render(<ProjectSwitcher />);
    fireEvent.click(await findByTitle(/project: Default/));
    fireEvent.click(getByText("Py Run"));
    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ data: "py" }));
    await waitFor(() => expect(location.reload).toHaveBeenCalled());
  });

  it("creates a project from the prompt and routes to the sync page", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("  Fresh Run  ");
    const { findByTitle, getByText } = render(<ProjectSwitcher />);
    fireEvent.click(await findByTitle(/project: Default/));
    fireEvent.click(getByText("+ new project…"));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ data: "Fresh Run" }));
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith("/settings?tab=data"));
  });

  it("offers remove only for non-default projects", async () => {
    const { findByTitle, getAllByTitle } = render(<ProjectSwitcher />);
    fireEvent.click(await findByTitle(/project: Default/));
    // exactly one ✕ (Py Run); 'default' is protected
    expect(getAllByTitle(/remove from list/)).toHaveLength(1);
  });
});
