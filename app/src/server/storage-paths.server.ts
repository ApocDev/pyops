export function storagePathsResponse<T extends Record<string, string>>(
  paths: T,
  hidden = process.env.PYOPS_HIDE_STORAGE_PATHS === "true",
): { hidden: true } | ({ hidden: false } & T) {
  if (hidden) return { hidden: true };
  return { hidden: false, ...paths };
}
