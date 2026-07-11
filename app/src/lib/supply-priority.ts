const KEY = "pyops.advancedSupplyPriorities";
const EVENT = "pyops-supply-priority-preference";

export const SUPPLY_PRIORITY = {
  preferred: 100,
  normal: 0,
  fallback: -100,
} as const;

export function getAdvancedSupplyPriorities() {
  return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
}

export function setAdvancedSupplyPriorities(enabled: boolean) {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, enabled ? "1" : "0");
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function subscribeAdvancedSupplyPriorities(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
