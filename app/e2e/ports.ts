/**
 * Ports for the two e2e dev servers and their UDP bridges. Each is overridable
 * so two e2e runs can share one machine (parallel checkouts or agents) without
 * colliding. The defaults stay clear of a real app/mod on 3000 and 37657.
 * Specs read the same values, so a fake-mod socket always targets the bridge
 * its server actually bound.
 */
const port = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

/** The read-only server's HTTP port. */
export const PORT = port("E2E_PORT", 3100);
/** The mutating server's HTTP port. */
export const MUT_PORT = port("E2E_MUT_PORT", 3101);
/** The read-only server's UDP bridge port (the one bridge*.e2e.ts talk to). */
export const BRIDGE_PORT = port("E2E_BRIDGE_PORT", 37659);
/** The mutating server's UDP bridge port. */
export const MUT_BRIDGE_PORT = port("E2E_MUT_BRIDGE_PORT", 37661);
