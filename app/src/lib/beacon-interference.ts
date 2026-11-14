/**
 * Beacon interference, as Pyanodons enforces it (pycoalprocessing
 * scripts/beacons.lua, `beacon_check`): a machine reached by two conflicting Py
 * beacons is disabled. The dump helper reduces the rule to data. Each Py beacon
 * lists the groups it occupies: its AM and FM levels with the `future-beacons`
 * setting on, or its AM/FM pair with it off. Two beacons on one machine conflict
 * when they share a group, and more than one copy of the same Py beacon always
 * conflicts with itself. Beacons with no groups never interfere. Machines Py
 * exempts (its alien-life buildings) are the caller's check.
 */

/** Names of the beacons in a machine's beacon set that interfere. Empty when the
 * set is safe. `groupsOf` returns a beacon's interference groups (null = none). */
export function interferingBeacons(
  beacons: readonly { beacon: string; count: number }[],
  groupsOf: (beacon: string) => readonly string[] | null | undefined,
): string[] {
  const holder = new Map<string, string>(); // group → first beacon in it
  const conflicts = new Set<string>();
  for (const { beacon, count } of beacons) {
    const groups = groupsOf(beacon);
    if (count <= 0 || !groups?.length) continue;
    if (count > 1) conflicts.add(beacon);
    for (const group of groups) {
      const prior = holder.get(group);
      if (prior == null) holder.set(group, beacon);
      else conflicts.add(prior).add(beacon);
    }
  }
  return [...conflicts];
}
