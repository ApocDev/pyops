import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { MUT_DATA_DIR, goto } from "./helpers";

type AiConfig = {
  aiProvider?: string;
  openaiCompatibleBaseUrl?: string;
  openaiCompatibleModel?: string;
};

/** Settings → Planning → Assistant: switching to an OpenAI-compatible endpoint
 * shows its URL, key, and model fields, saves them into app-config.json, and the
 * setup warning names what is still missing until the endpoint is usable. The
 * endpoint is a closed local port, so the model list stays empty and no request
 * reaches a real provider. */
test("assistant provider switches to an OpenAI-compatible endpoint", async ({ page }) => {
  const readConfig = (): AiConfig => {
    const file = join(MUT_DATA_DIR, "app-config.json");
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as AiConfig) : {};
  };
  const baseUrl = "http://127.0.0.1:9/v1";

  await goto(page, "/settings?tab=planning");
  const provider = page.getByRole("group", { name: "Assistant provider" });
  await expect(provider.getByRole("button", { name: "OpenRouter" })).toBeVisible();

  await provider.getByRole("button", { name: "OpenAI-compatible" }).click();
  await expect(provider.getByRole("button", { name: "OpenAI-compatible" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => readConfig().aiProvider).toBe("openai-compatible");

  const url = page.getByRole("textbox", { name: "Endpoint URL" });
  await expect(url).toBeVisible();
  await expect(page.getByLabel("Endpoint API key")).toBeVisible();

  // URL first: the warning moves on to the missing model
  await url.fill(baseUrl);
  await url.locator("xpath=..").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => readConfig().openaiCompatibleBaseUrl).toBe(baseUrl);
  await expect(page.getByText(/No model set for the OpenAI-compatible endpoint/)).toBeVisible();
  await expect(page.getByText("The endpoint listed no models. Type a model id.")).toBeVisible();

  // then a model: the endpoint is fully configured and the warning clears
  const model = page.getByRole("textbox", { name: "Model" });
  await model.fill("local/test-model");
  await model.locator("xpath=..").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => readConfig().openaiCompatibleModel).toBe("local/test-model");
  await expect(page.getByText(/No model set/)).toBeHidden();

  // the stored endpoint survives a reload
  await goto(page, "/settings?tab=planning");
  await expect(page.getByRole("textbox", { name: "Endpoint URL" })).toHaveValue(baseUrl);
  await expect(page.getByRole("textbox", { name: "Model" })).toHaveValue("local/test-model");

  // switching back keeps the endpoint settings but restores OpenRouter mode
  await page
    .getByRole("group", { name: "Assistant provider" })
    .getByRole("button", { name: "OpenRouter" })
    .click();
  await expect.poll(() => readConfig().aiProvider).toBe("openrouter");
  await expect(page.getByRole("textbox", { name: "Endpoint URL" })).toBeHidden();
  expect(readConfig().openaiCompatibleBaseUrl).toBe(baseUrl);
});
