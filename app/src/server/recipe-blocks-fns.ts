/**
 * Server-fn wrapper for recipe → block lookups (client-importable by design:
 * the server-only module is referenced only inside `.handler()` bodies).
 */
import { createServerFn } from "@tanstack/react-start";

import { blocksUsingRecipe, recipeFocusInfo } from "../db/recipe-blocks.server.ts";

/** The enabled blocks running a recipe, plus its localized name — the factory
 * resource view lists them when the game's focus hotkey matched several. */
export const blocksUsingRecipeFn = createServerFn({ method: "GET" })
  .validator((recipe: string) => recipe)
  .handler(async ({ data }) => ({
    display: recipeFocusInfo(data)?.display ?? data,
    blocks: blocksUsingRecipe(data),
  }));
