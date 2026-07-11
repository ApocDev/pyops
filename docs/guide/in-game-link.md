---
title: Connect PyOps to Factorio
description: Install the Companion mod, launch Factorio with the Live bridge, and verify live synchronization.
outline: [2, 3]
---

# Connect PyOps to Factorio

The **Companion mod** runs inside Factorio. The **Live bridge** is the local connection
between that mod and the PyOps app. Together they enable:

- the in-game PyOps panel;
- live research and TURD selections;
- built-machine and production statistics;
- **Locate in game** and **Open in game** actions;
- immediate state synchronization from the in-game panel.

Planning blocks does not require the connection. Use it when the project should follow a
running save or when you want the in-game tools.

## Use PyOps without the Companion mod

The Companion mod is optional. Without it, you can still:

- sync recipes, items, technologies, and icons from the local Factorio installation;
- create and solve blocks;
- inspect the whole factory with Factory, Coherence, Browse, and Deps;
- choose a planning horizon and record TURD selections manually;
- use project backups, block exports, tasks, and the Assistant's project tools.

What you lose is live save state and in-game interaction. Completed research, TURD choices,
placed machines, production statistics, and player position do not update automatically,
and actions such as **Locate in game** are unavailable.

For a manual workflow, set **Planning horizon** to **Future** or maintain **completed
research** under **Settings → Planning**. Record TURD selections on the TURD page, then
resync game data only when the installed mods or their versions change.

## Install the Companion mod

1. Close Factorio.
2. Open **Settings → In-game link**.
3. Under **Companion mod**, select **Symlink (recommended)**.

The symlink points Factorio at the mod bundled with PyOps, so app updates and mod updates
stay together. On Windows, PyOps creates a directory junction without requiring
Administrator access or Developer Mode.

Use **Copy to mods dir** when a link is unsuitable for the installation. A copied mod does
not update with the app; use **Re-copy** after installing a newer PyOps build.

<AppScreenshot
  src="/images/in-game-link.png"
  alt="The In-game link settings page with Companion mod installation controls and a connected Live bridge"
  caption="The Companion mod controls installation. Live bridge reports the separate runtime connection. Local filesystem and player details are omitted from this capture."
/>

## Launch Factorio with the bridge

Under **Live bridge**, select **Launch Factorio**. PyOps supplies the required
`--enable-lua-udp` launch option and chooses the game-side UDP port. The Companion mod then
connects automatically; there is no in-game enable toggle.

The navigation status indicates the result:

- **no game**: PyOps is listening, but no Companion mod is connected;
- **game linked**: recent packets are arriving from the mod;
- **mod mismatch**: the app and installed mod use different bridge protocol versions;
- **bridge error**: PyOps could not open its local UDP listener.

::: tip Prefer Launch Factorio
Launching the game normally through Steam does not necessarily include the UDP option.
Use PyOps' button whenever you want the live connection.
:::

## Make every Steam launch bridge-ready

Steam can apply the UDP option whenever it starts Factorio:

1. Open the Steam library.
2. Right-click **Factorio** and select **Properties**.
3. Under **General**, find **Launch Options**.
4. Enter:

```text
--enable-lua-udp 37658
```

Factorio then opens its Lua UDP socket on port `37658` for every Steam launch, and the
Companion mod can connect without starting the game through PyOps.

::: warning The game and app ports must be different
PyOps listens on `37657` by default, while Factorio uses `37658` in the launch option.
Factorio cannot bind the same local port as the app. Leave the Companion mod's bridge-port
setting pointed at the PyOps port (`37657`) unless the app is configured to listen
somewhere else.
:::

## Synchronize the save

Research updates automatically when a technology finishes. To request the complete state
immediately, select **pull from game** under **Live bridge** or select **Sync now** in the
in-game PyOps panel.

After synchronization:

- **Planning horizon → Now** reflects completed research;
- the TURD page reflects the save's branch selections;
- Factory can compare planned rates with live production;
- Factory's machine section compares required buildings with placed buildings.

The green **live** labels include the age of the most recent data. Treat an old timestamp
as stale even if the bridge has reconnected.

## Troubleshoot the connection

### The status remains “no game”

1. Confirm the Companion mod card says **linked** or **copied**.
2. Close Factorio and select **Launch Factorio** from PyOps.
3. Confirm the `pyops` mod is enabled in Factorio's mod list.
4. Return to **Settings → In-game link** and check for a bridge error.

### The status says “mod mismatch”

Close Factorio, then use **Re-link** or **Re-copy** so the installed Companion mod matches
the app. Start Factorio again from **Launch Factorio**.

### The bridge reports a UDP bind error

Another process is using the configured bridge port, or another PyOps instance is already
running. Close the duplicate process and restart PyOps. Advanced installations can change
the app's bridge port, but the Companion mod setting must point to the same port.

### The bridge is linked but live values are stale

Select **pull from game**. If the timestamp does not advance, open the in-game PyOps panel
and select **Sync now**, then check the bridge packet counts for activity.

::: warning Keep the bridge local
The standard bridge listens on localhost. Do not expose its UDP port to an untrusted
network.
:::
