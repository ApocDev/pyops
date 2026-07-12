import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

import { AppLiveQueries } from "../components/app-live-queries";
import { AppNav } from "../components/app-nav";
import { CommandPalette } from "../components/command-palette";
import { DbMigrationsBanner } from "../components/db-migrations-banner";
import { DriftModal } from "../components/drift-modal";
import { GoodExplorerDialog } from "../components/good-explorer-dialog";
import { NativeContextMenu } from "../components/native-context-menu";
import { RouteError } from "../components/route-error";
import { RoutePending } from "../components/route-pending";
import { ShortcutHelpSheet } from "../components/shortcut-help-sheet";
import { UndoHotkey } from "../components/undo-hotkey";
import { UpdatePrompt } from "../components/update-prompt";
import { WorkspaceNav } from "../components/workspace-nav";
import { Toaster } from "../components/ui/toast";
import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "PyOps",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.svg",
        type: "image/svg+xml",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  errorComponent: RouteError,
  pendingComponent: RoutePending,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Pre-paint theme (#107): correct the SSR'd `dark` class before first
            paint from the stored pyops.theme preference, so switching to light /
            system never flashes the wrong palette. Mirrors lib/theme.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var p=localStorage.getItem('pyops.theme')||'dark';" +
              "var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);" +
              "var r=document.documentElement;r.classList.toggle('dark',d);" +
              "r.style.colorScheme=d?'dark':'light';}catch(e){}})();",
          }}
        />
      </head>
      <body>
        <AppLiveQueries />
        <div className="flex h-screen flex-col">
          <AppNav />
          <WorkspaceNav />
          <DbMigrationsBanner />
          <div data-app-content className="min-h-0 flex-1 overflow-auto">
            {children}
          </div>
        </div>
        <CommandPalette />
        <ShortcutHelpSheet />
        <NativeContextMenu />
        <UndoHotkey />
        <Toaster />
        <DriftModal />
        <GoodExplorerDialog />
        <UpdatePrompt />
        <TanStackDevtools
          config={{
            position: "bottom-right",
            hideUntilHover: true,
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
