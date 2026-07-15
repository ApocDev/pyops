import { fmtTemp, fmtTempRange } from "./format.ts";
import {
  qualifiedGoodKey,
  type QualifiedGood,
  type TemperatureMode,
} from "../solver/temperature-flow.ts";

export type FactoryFlowQualifier = {
  item: string;
  kind: string;
  temperatureMode?: TemperatureMode | null;
  minTemp?: number | null;
  maxTemp?: number | null;
  hasTemperatureVariants?: boolean;
};

/** Overview identity for one boundary-fluid contract. A pinned consumer is
 * persisted as a one-point range; normalize it to the matching exact producer
 * so both sides net on the same row. Wider accepted ranges stay distinct. */
export function factoryFlowKey(flow: FactoryFlowQualifier): string {
  if (flow.hasTemperatureVariants === false) return flow.item;
  const exactRange =
    flow.temperatureMode === "range" &&
    flow.minTemp != null &&
    flow.maxTemp != null &&
    flow.minTemp === flow.maxTemp;
  const normalized: QualifiedGood = exactRange ? { ...flow, temperatureMode: "exact" } : flow;
  return qualifiedGoodKey(normalized);
}

/** Human-readable temperature contract shown beside the localized fluid name. */
export function factoryFlowTemperature(flow: FactoryFlowQualifier): string | null {
  if (flow.kind !== "fluid" || flow.hasTemperatureVariants === false) return null;
  if (flow.temperatureMode === "exact") return fmtTemp(flow.minTemp);
  if (flow.temperatureMode === "range") return fmtTempRange(flow.minTemp, flow.maxTemp);
  return null;
}
