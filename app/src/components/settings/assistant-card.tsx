import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useId, useState } from "react";
import { aiConfigFn, setAiConfigFn } from "#/server/factorio.ts";
import { InfoHint } from "#/components/info-hint.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Callout } from "#/components/ui/callout.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { FieldLabel } from "#/components/ui/label.tsx";
import { Segmented } from "#/components/ui/segmented.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

type AiConfigPatch = Parameters<typeof setAiConfigFn>[0]["data"];

const PROVIDERS = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
] as const;

const ENV_HINT =
  "Env vars take priority when set; these stored values are the fallback. " +
  "PYOPS_AI_PROVIDER picks the provider. OpenRouter: OPENROUTER_API_KEY. " +
  "OpenAI-compatible: PYOPS_OPENAI_COMPATIBLE_BASE_URL and PYOPS_OPENAI_COMPATIBLE_API_KEY. " +
  "PYOPS_AGENT_MODEL sets the model for either.";

const fieldClass = "min-w-0 flex-1 sm:max-w-80";

/** Assistant / AI config: the provider (OpenRouter or an OpenAI-compatible
 * endpoint such as LiteLLM), its connection settings, and the default model.
 * App-level (your AI account, not a project). Env vars win; stored values are
 * the fallback. */
export function AssistantCard() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["aiConfig"], queryFn: () => aiConfigFn() });
  const save = useMutation({
    mutationFn: (d: AiConfigPatch) => setAiConfigFn({ data: d }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["aiConfig"] });
      // each chat's setup warning and model menu depend on these settings
      await qc.invalidateQueries({ queryKey: ["conversation-model"] });
    },
  });
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const modelListId = useId();
  const d = cfg.data;
  if (!d) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assistant (AI)</CardTitle>
        </CardHeader>
        <div className="space-y-2 px-3 pb-3">
          {cfg.isError ? (
            <p className="text-sm text-destructive">Couldn&apos;t load: {cfg.error.message}</p>
          ) : (
            <>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-8 w-72" />
              <Skeleton className="h-8 w-72" />
            </>
          )}
        </div>
      </Card>
    );
  }
  const compat = d.provider === "openai-compatible";
  const baseUrlValue = baseUrl ?? d.baseUrl;
  const modelValue = model ?? d.model;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assistant (AI)</CardTitle>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3 text-sm">
        <p className="flex items-center gap-1.5 text-muted-foreground">
          Shared across all projects.
          <InfoHint content={ENV_HINT} />
        </p>

        <div>
          <FieldLabel>Provider</FieldLabel>
          {d.providerFromEnv ? (
            <EnvSet name="PYOPS_AI_PROVIDER" value={d.provider} />
          ) : (
            <Segmented
              aria-label="Assistant provider"
              value={d.provider}
              onValueChange={(v) => {
                setModel(null);
                save.mutate({ aiProvider: v });
              }}
              options={PROVIDERS}
              className="mt-1"
            />
          )}
        </div>

        {compat ? (
          <>
            <div>
              <FieldLabel>Endpoint URL</FieldLabel>
              {d.baseUrlFromEnv ? (
                <EnvSet name="PYOPS_OPENAI_COMPATIBLE_BASE_URL" />
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    aria-label="Endpoint URL"
                    value={baseUrlValue}
                    placeholder="Base URL, e.g. https://gateway.example/v1"
                    onChange={(e) => setBaseUrl(e.target.value)}
                    className={fieldClass}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={baseUrl === null}
                    onClick={() => {
                      save.mutate({ openaiCompatibleBaseUrl: baseUrlValue });
                      setBaseUrl(null);
                    }}
                  >
                    Save
                  </Button>
                </div>
              )}
            </div>
            <SecretField
              label="Endpoint API key"
              envName="PYOPS_OPENAI_COMPATIBLE_API_KEY"
              fromEnv={d.compatKeyFromEnv}
              stored={d.compatKeyStored}
              placeholder="Bearer token (optional for local servers)"
              onSave={(v) => save.mutate({ openaiCompatibleApiKey: v })}
            />
          </>
        ) : (
          <SecretField
            label="OpenRouter API key"
            envName="OPENROUTER_API_KEY"
            fromEnv={d.keyFromEnv}
            stored={d.keyStored}
            placeholder="OpenRouter key (sk-or-…)"
            onSave={(v) => save.mutate({ openrouterApiKey: v })}
          />
        )}

        <div>
          <FieldLabel>Model</FieldLabel>
          {d.modelFromEnv ? (
            <EnvSet name="PYOPS_AGENT_MODEL" value={d.resolvedModel} />
          ) : (
            <>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  aria-label="Model"
                  value={modelValue}
                  placeholder={d.defaultModel || "Model id"}
                  list={d.models?.length ? modelListId : undefined}
                  onChange={(e) => setModel(e.target.value)}
                  className={fieldClass}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={model === null}
                  onClick={() => {
                    save.mutate({ model: modelValue });
                    setModel(null);
                  }}
                >
                  Save
                </Button>
              </div>
              {d.models && (d.baseUrl || d.baseUrlFromEnv) && (
                <>
                  <datalist id={modelListId}>
                    {d.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <p className="mt-1 text-muted-foreground">
                    {d.models.length
                      ? `${d.models.length} chat models listed by the endpoint.`
                      : "The endpoint listed no models. Type a model id."}
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {d.problem && <Callout tone="warning">{d.problem}</Callout>}
        {save.isError && (
          <p className="text-sm text-destructive">Save failed: {save.error.message}</p>
        )}
      </div>
    </Card>
  );
}

/** "Set via ENV (wins)" line shown in place of a field an env var overrides. */
function EnvSet({ name, value }: { name: string; value?: string }) {
  return (
    <div className="mt-1 flex items-center gap-1 text-sm text-success">
      <Check className="size-3.5" /> Set via {name} env (wins){value ? `: ${value}` : ""}
    </div>
  );
}

/** A write-only key field: type to replace, Clear to remove. The stored key is
 * never shown or sent back to the client. */
function SecretField({
  label,
  envName,
  fromEnv,
  stored,
  placeholder,
  onSave,
}: {
  label: string;
  envName: string;
  fromEnv: boolean;
  stored: boolean;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {fromEnv ? (
        <EnvSet name={envName} />
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <Input
            type="password"
            aria-label={label}
            value={value}
            placeholder={stored ? "•••••••• (stored — type to replace)" : placeholder}
            onChange={(e) => setValue(e.target.value)}
            className={fieldClass}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onSave(value);
              setValue("");
            }}
            disabled={!value.trim()}
          >
            Save
          </Button>
          {stored && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSave("")}
              className="text-muted-foreground hover:text-destructive"
            >
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
