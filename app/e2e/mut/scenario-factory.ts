/**
 * A small coal-processing factory for the Scenario specs. Hydrocarbons turns
 * raw coal into coal (coke feedstock) and aromatics, with coal gas as a
 * coproduct; it burns its own pitch and gasoline for 250° steam and imports
 * the rest of its steam and electricity from the Steam and Electricity blocks.
 * A Coal gas block consumes the coal and makes more coal gas.
 *
 * `seedScenarioFactory` clears the factory first, so a Scenario solve only sees
 * these blocks.
 */
import { type BlockDoc, clearFactory, insertBlock, setFactoryPins } from "./helpers";

const hydrocarbons: BlockDoc = {
  recipes: [
    "distilled-raw-coal",
    "coal-gas",
    "tar-refining",
    "tar-refining-tops",
    "carbolic-oil-creosote",
    "light-oil-aromatics",
    "naphthalene-oil-creosote",
    "anthracene-gasoline-cracking",
    "burn-fluid-pitch",
    "burn-fluid-gasoline",
  ],
  supplyPriority: -100,
  made: [
    "anthracene-oil",
    "carbolic-oil",
    "gasoline",
    "light-oil",
    "middle-oil",
    "naphthalene-oil",
    "pitch",
    "steam",
    "tar",
  ],
  pins: [
    { kind: "drain", recipe: "tar-refining", item: "tar" },
    { kind: "drain", recipe: "tar-refining-tops", item: "middle-oil" },
    { kind: "drain", recipe: "carbolic-oil-creosote", item: "carbolic-oil" },
    { kind: "drain", recipe: "light-oil-aromatics", item: "light-oil" },
    { kind: "drain", recipe: "naphthalene-oil-creosote", item: "naphthalene-oil" },
    { kind: "drain", recipe: "anthracene-gasoline-cracking", item: "anthracene-oil" },
    { kind: "drain", recipe: "coal-gas", item: "coal" },
    { kind: "drain", recipe: "burn-fluid-pitch", item: "pitch" },
    { kind: "drain", recipe: "burn-fluid-gasoline", item: "gasoline" },
  ],
  machines: {
    "distilled-raw-coal": "distilator",
    "tar-refining": "tar-processing-unit",
    "tar-refining-tops": "tar-processing-unit",
    "carbolic-oil-creosote": "tar-processing-unit",
    "light-oil-aromatics": "distilator",
    "naphthalene-oil-creosote": "tar-processing-unit",
    "anthracene-gasoline-cracking": "distilator",
    "coal-gas": "distilator",
  },
  fluidTemperatures: { "tar-refining": { steam: 250 }, "tar-refining-tops": { steam: 250 } },
  goals: [
    { name: "coal", rate: 1.25 },
    { name: "aromatics", rate: 90.8506 },
  ],
};

const steam: BlockDoc = {
  recipes: ["boil-steam-250", "mine-raw-coal"],
  supplyPriority: -100,
  made: ["ash", "iron-oxide", "raw-coal", "water"],
  machines: { "boil-steam-250": "boiler", "mine-raw-coal": "electric-mining-drill" },
  fuels: { "boil-steam-250": "raw-coal", "mine-raw-coal": "coal" },
  fluidTemperatures: { "boil-steam-250": { water: 15 } },
  goals: [{ name: "steam", rate: 100, temperature: 250 }],
};

const electricity: BlockDoc = {
  recipes: ["generate-steam-engine-250", "boil-steam-250"],
  made: ["steam"],
  machines: { "generate-steam-engine-250": "steam-engine", "boil-steam-250": "boiler" },
  fuels: { "boil-steam-250": "raw-coal" },
  fluidTemperatures: { "boil-steam-250": { water: 15 } },
  goals: [{ name: "pyops-electricity", rate: 100 }],
};

const coalGas: BlockDoc = {
  recipes: ["coal-gas"],
  machines: { "coal-gas": "distilator" },
  goals: [{ name: "coal-gas", rate: 10 }],
};

export type ScenarioFactory = { hydrocarbons: { id: number; name: string } };

/** Replace the scratch factory with the fixture blocks and demand pins. */
export function seedScenarioFactory(): ScenarioFactory {
  clearFactory();
  const id = insertBlock("Hydrocarbons", hydrocarbons);
  insertBlock("Steam 250°", steam);
  insertBlock("Electricity", electricity);
  insertBlock("Coal gas", coalGas);
  setFactoryPins([
    { good: "aromatics", kind: "fluid", rate: 100 },
    { good: "coal-gas", kind: "fluid", rate: 200 },
  ]);
  return { hydrocarbons: { id, name: "Hydrocarbons" } };
}
