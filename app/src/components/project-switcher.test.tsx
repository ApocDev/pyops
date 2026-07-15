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
  // jsdom has no ResizeObserver; Radix popper positioning needs one
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

/** The Radix DropdownMenu trigger opens on pointerdown, not click. */
const openMenu = (trigger: Element) => fireEvent.pointerDown(trigger);

describe("ProjectSwitcher", () => {
  it("labels the trigger with the active project", async () => {
    const { findByTitle } = render(<ProjectSwitcher />);
    expect(await findByTitle(/Project: Default/)).toBeTruthy();
  });

  it("opens a dropdown listing every project plus a create action", async () => {
    const { findByTitle, getByText } = render(<ProjectSwitcher />);
    openMenu(await findByTitle(/Project: Default/));
    expect(getByText("Py Run")).toBeTruthy();
    expect(getByText("+ New project…")).toBeTruthy();
  });

  it("switches project then reloads (queries belong to the old db)", async () => {
    const { findByTitle, getByText } = render(<ProjectSwitcher />);
    openMenu(await findByTitle(/Project: Default/));
    fireEvent.click(getByText("Py Run"));
    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ data: "py" }));
    await waitFor(() => expect(location.reload).toHaveBeenCalled());
  });

  it("creates a project through the dialog and routes to the sync page", async () => {
    const { findByTitle, getByText, getByLabelText } = render(<ProjectSwitcher />);
    openMenu(await findByTitle(/Project: Default/));
    fireEvent.click(getByText("+ New project…"));
    // dialog is open: create is disabled until a name is typed (whitespace doesn't count)
    const createBtn = getByText("Create project").closest("button")!;
    expect(createBtn.disabled).toBe(true);
    fireEvent.change(getByLabelText("Name"), { target: { value: "   " } });
    expect(createBtn.disabled).toBe(true);
    fireEvent.change(getByLabelText("Name"), { target: { value: "  Fresh Run  " } });
    expect(createBtn.disabled).toBe(false);
    fireEvent.click(createBtn);
    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ data: "Fresh Run" }));
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith("/settings?tab=data"));
  });

  it("submits the create dialog on Enter (form submit)", async () => {
    const { findByTitle, getByText, getByLabelText } = render(<ProjectSwitcher />);
    openMenu(await findByTitle(/Project: Default/));
    fireEvent.click(getByText("+ New project…"));
    const input = getByLabelText("Name");
    fireEvent.change(input, { target: { value: "Enter Run" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ data: "Enter Run" }));
  });

  it("surfaces a create failure in the dialog instead of navigating", async () => {
    createProject.mockRejectedValue(new Error("disk full"));
    const { findByTitle, getByText, getByLabelText, findByText } = render(<ProjectSwitcher />);
    openMenu(await findByTitle(/Project: Default/));
    fireEvent.click(getByText("+ New project…"));
    fireEvent.change(getByLabelText("Name"), { target: { value: "Doomed" } });
    fireEvent.click(getByText("Create project"));
    expect(await findByText("disk full")).toBeTruthy();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it("cancels the create dialog without creating anything", async () => {
    const { findByTitle, getByText, queryByText } = render(<ProjectSwitcher />);
    openMenu(await findByTitle(/Project: Default/));
    fireEvent.click(getByText("+ New project…"));
    fireEvent.click(getByText("Cancel"));
    await waitFor(() => expect(queryByText("Create project")).toBeNull());
    expect(createProject).not.toHaveBeenCalled();
  });

  it("offers remove only for non-default projects", async () => {
    const { findByTitle, getAllByTitle } = render(<ProjectSwitcher />);
    openMenu(await findByTitle(/Project: Default/));
    // exactly one ✕ (Py Run); 'default' is protected
    expect(getAllByTitle(/Remove from list/)).toHaveLength(1);
  });
});
