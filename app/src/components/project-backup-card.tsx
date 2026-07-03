import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { listProjectsFn, setActiveProjectFn } from "../server/factorio";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";

/** Settings card (#82): download the active project's database as a backup file,
 * and restore/import a .db as a new project (never overwriting an existing one). */
export function ProjectBackupCard() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => listProjectsFn() });
  const fileInput = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<{ id: string; name: string } | null>(null);

  const importDb = useMutation({
    mutationFn: async (file: File) => {
      // default the project name to the file name (sans extension); the server
      // falls back to the db's own self-described name when this is empty
      const base = file.name.replace(/\.db$/i, "").trim();
      const res = await fetch(`/api/backup?name=${encodeURIComponent(base)}`, {
        method: "POST",
        body: file,
      });
      const body = (await res.json()) as { id?: string; name?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? `import failed (${res.status})`);
      return { id: body.id, name: body.name ?? body.id };
    },
    onSuccess: (p) => setImported(p),
  });

  const switchTo = async (id: string) => {
    await setActiveProjectFn({ data: id });
    // full reload on purpose — same flush as the project switcher (#84)
    window.location.reload();
  };

  const active = projects.data?.projects.find((p) => p.id === projects.data?.active);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project backup</CardTitle>
      </CardHeader>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-sm text-muted-foreground">
          All planning work lives in the project&apos;s database file. Download it as a backup (safe
          while the app is running), and restore a backup as a new project — an import never
          overwrites anything.
        </p>
        {projects.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href="/api/backup" download>
                <Download className="size-4" /> Download {active ? `“${active.name}”` : "backup"}
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={importDb.isPending}
            >
              <Upload className="size-4" />
              {importDb.isPending ? "importing…" : "Import backup…"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".db"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // allow re-picking the same file
                if (f) {
                  setImported(null);
                  importDb.mutate(f);
                }
              }}
            />
          </div>
        )}
        {projects.isError && (
          <p className="text-sm text-destructive">
            couldn&apos;t load projects: {projects.error.message}
          </p>
        )}
        {importDb.isError && (
          <p className="text-sm text-destructive">import failed: {importDb.error.message}</p>
        )}
        {imported && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-success">
            imported as project &ldquo;{imported.name}&rdquo;
            <Button variant="outline" size="sm" onClick={() => void switchTo(imported.id)}>
              Switch to it
            </Button>
          </p>
        )}
      </div>
    </Card>
  );
}
