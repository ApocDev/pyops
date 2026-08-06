import { describe, expect, it } from "vite-plus/test";
import { storagePathsResponse } from "./storage-paths.server.ts";

const paths = { dataDir: "/home/example/private-data" };

describe("storagePathsResponse", () => {
  it("omits paths entirely when storage locations are hidden", () => {
    expect(storagePathsResponse(paths, true)).toEqual({ hidden: true });
  });

  it("returns paths when storage locations are visible", () => {
    expect(storagePathsResponse(paths, false)).toEqual({ hidden: false, ...paths });
  });
});
