/** Whether this instance hides absolute server paths from the browser (set for
 * instances exposed beyond the local machine, e.g. a tunneled demo). */
export function storagePathsHidden(): boolean {
  return process.env.PYOPS_HIDE_STORAGE_PATHS === "true";
}

export function storagePathsResponse<T extends Record<string, string>>(
  paths: T,
  hidden = storagePathsHidden(),
): { hidden: true } | ({ hidden: false } & T) {
  if (hidden) return { hidden: true };
  return { hidden: false, ...paths };
}
