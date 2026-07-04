// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { QueryBoundary } from "./query-boundary.tsx";
import { QueryError } from "./query-error.tsx";
import { RouteError } from "./route-error.tsx";

// RouteError pulls `useRouter().invalidate()` — stub the router so the component
// renders standalone (the failing-route contract is: a real error surface, not a
// white screen).
const invalidate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Q<T> = Parameters<typeof QueryBoundary<T>>[0]["query"];

const q = <T,>(partial: Partial<Q<T>>): Q<T> => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  ...partial,
});

describe("QueryBoundary", () => {
  it("renders a skeleton while loading and not the children", () => {
    const { container, queryByText } = render(
      <QueryBoundary query={q<number>({ isLoading: true })}>
        {(n) => <span>value {n}</span>}
      </QueryBoundary>,
    );
    expect(container.querySelector('[data-slot="query-loading"]')).not.toBeNull();
    expect(queryByText(/value/)).toBeNull();
  });

  it("treats undefined data as still loading even when isLoading is false", () => {
    const { container } = render(
      <QueryBoundary query={q<number>({ data: undefined })}>{() => <span>x</span>}</QueryBoundary>,
    );
    expect(container.querySelector('[data-slot="query-loading"]')).not.toBeNull();
  });

  it("shows a retryable error surface and wires refetch", () => {
    const refetch = vi.fn();
    const { getByRole, getByText } = render(
      <QueryBoundary query={q<number>({ isError: true, error: new Error("boom"), refetch })}>
        {(n) => <span>value {n}</span>}
      </QueryBoundary>,
    );
    expect(getByText("boom")).not.toBeNull();
    fireEvent.click(getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the empty node when isEmpty is true", () => {
    const { getByText, queryByText } = render(
      <QueryBoundary
        query={q<number[]>({ data: [] })}
        isEmpty={(d) => d.length === 0}
        empty={<div>nothing</div>}
      >
        {(rows) => <span>rows {rows.length}</span>}
      </QueryBoundary>,
    );
    expect(getByText("nothing")).not.toBeNull();
    expect(queryByText(/rows/)).toBeNull();
  });

  it("renders children with resolved data", () => {
    const { getByText } = render(
      <QueryBoundary query={q<number>({ data: 42 })}>
        {(n) => <span>value {n}</span>}
      </QueryBoundary>,
    );
    expect(getByText("value 42")).not.toBeNull();
  });
});

describe("QueryError", () => {
  it("omits the retry button when no onRetry is given", () => {
    const { queryByRole, getByText } = render(<QueryError title="nope" />);
    expect(getByText("nope")).not.toBeNull();
    expect(queryByRole("button", { name: /retry/i })).toBeNull();
  });
});

describe("RouteError", () => {
  it("renders the error message and invalidates the router on retry", () => {
    const reset = vi.fn();
    const { getByText, getByRole } = render(
      // `info` is unused by the component; the router supplies it at runtime.
      <RouteError
        error={new Error("route exploded")}
        reset={reset}
        info={{ componentStack: "" }}
      />,
    );
    expect(getByText("route exploded")).not.toBeNull();
    fireEvent.click(getByRole("button", { name: /retry/i }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
