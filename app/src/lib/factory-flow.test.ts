import { describe, expect, it } from "vite-plus/test";
import { factoryFlowKey, factoryFlowTemperature } from "./factory-flow.ts";

describe("factory fluid flow identity", () => {
  it("nets a pinned one-point consumer range with its exact producer", () => {
    const producer = {
      item: "steam",
      kind: "fluid",
      temperatureMode: "exact" as const,
      minTemp: 250,
      maxTemp: 250,
    };
    const consumer = { ...producer, temperatureMode: "range" as const };

    expect(factoryFlowKey(consumer)).toBe(factoryFlowKey(producer));
    expect(factoryFlowTemperature(producer)).toBe("250°");
    expect(factoryFlowTemperature(consumer)).toBe("250°");
  });

  it("keeps wider accepted ranges and other exact temperatures distinct", () => {
    const range = {
      item: "steam",
      kind: "fluid",
      temperatureMode: "range" as const,
      minTemp: 15,
      maxTemp: null,
    };
    const cool = {
      item: "steam",
      kind: "fluid",
      temperatureMode: "exact" as const,
      minTemp: 250,
      maxTemp: 250,
    };
    const hot = { ...cool, minTemp: 500, maxTemp: 500 };

    expect(new Set([factoryFlowKey(range), factoryFlowKey(cool), factoryFlowKey(hot)]).size).toBe(
      3,
    );
    expect(factoryFlowTemperature(range)).toBe("≥15°");
  });

  it("does not qualify solid items", () => {
    const item = {
      item: "iron-plate",
      kind: "item",
      temperatureMode: "exact" as const,
      minTemp: 250,
      maxTemp: 250,
    };

    expect(factoryFlowKey(item)).toBe("iron-plate");
    expect(factoryFlowTemperature(item)).toBeNull();
  });

  it("hides and collapses temperature for a fluid with no variants", () => {
    const fluid = {
      item: "formic-acid",
      kind: "fluid",
      temperatureMode: "range" as const,
      minTemp: 15,
      maxTemp: null,
      hasTemperatureVariants: false,
    };

    expect(factoryFlowKey(fluid)).toBe("formic-acid");
    expect(factoryFlowTemperature(fluid)).toBeNull();
  });
});
