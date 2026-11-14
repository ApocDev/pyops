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
- inspect the whole factory with the Factory and Explore workspaces;
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

The navigation status indicates the result. A narrower desktop window shows only its colored
dot; hover the dot to read the status.

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
immediately, select **pull from game** under **Live bridge** or open the in-game PyOps
panel, which pushes the full state each time it opens.

After synchronization:

- **Planning horizon → Now** reflects completed research;
- the TURD page reflects the save's branch selections;
- Factory can compare planned rates with live production;
- Factory's machine section compares required buildings with placed buildings.

The green **live** labels include the age of the most recent data. Treat an old timestamp
as stale even if the bridge has reconnected.

## Use the in-game panel

Open the panel with the PyOps button at the top left of the screen, the PyOps shortcut
button, or `Ctrl + Shift + P`. It has two tabs, **Blocks** and **Tasks**, and remembers
the last one you used.

### Read the status dot

The dot next to the **PyOps** title shows the bridge state. Hover it for details and click
it to ping the app again.

- **Green, Connected**: the app answered the last heartbeat.
- **Yellow, Connecting…**: the panel is waiting for the app on the bridge port. It shows
  for the first seconds after opening, and again if the app stops answering.
- **Red, No app link**: the app hasn't answered for about 15 seconds. Start PyOps, or
  check the Companion mod's bridge-port setting.
- **Red, Version mismatch**: the app and the mod use different bridge protocol versions.
  Re-link or re-copy the Companion mod.
- **Red, Lua UDP is off**: Factorio was started without `--enable-lua-udp`.

### Find a block on the Blocks tab

The **Blocks** tab shows every enabled block as a slot, with one row per block folder and
an **Ungrouped** row at the end. The slot color shows how much of the block is built:

- **green**: every machine the block needs is placed;
- **yellow**: some of its machines are placed;
- **grey**: none are placed yet, or the block needs no machines.

The number on a slot is the block's goal rate in the block's own time unit. Rates under
0.1 show no number. Hover a slot to see the block name, exact goal rate, power, and how
many machines are built.

Type in the search box to filter blocks by name. The check-mark button hides finished
(green) blocks.

The board updates by itself when you edit, add, or disable a block in PyOps, and when you
place or remove machines.

### Open a block's build sheet

Click a slot to open that block's build sheet next to the panel. The sheet lists each
recipe row with its machine and count, its products (blue slots), its ingredients (yellow
slots), and a **Built** column with how many of that machine are placed versus needed.
**Out** and **In** list what the whole block exports and imports.

From the sheet you can:

- click a machine to put a one-machine blueprint (recipe and modules set) on the cursor;
- press `Q` over a good or machine to pipette it;
- use the combinator button to size a request combinator for the block's imports;
- use the belt button to show belts and inserters for each good;
- use the arrow button in the title bar to open the block in PyOps.

The **Open in game** button on a block's page in PyOps opens the same sheet.

### Open a block in PyOps from the game

Shift-click a slot, or use the arrow button on the build sheet's title bar. Any open PyOps
window switches to that block's page within a few seconds.

### Jump from a machine to its block

Hover a machine in the world and press `Ctrl + Shift + O` (**PyOps: open the hovered
machine's block** in Factorio's controls settings). PyOps looks for the blocks that run
that machine's recipe. A mining drill counts as running the mining recipe for the ore
under it.

- **One block runs it**: the open PyOps window switches to that block.
- **Several blocks run it**: PyOps opens **Factory → Overview** with the drawer for the
  recipe's main product. The drawer lists every block running the recipe, so pick the one
  you meant.
- **No block runs it**: PyOps shows a "No block plans … yet" notice. Select **Create one**
  to open that product's drawer, which has a button to start a new block.

Flying text at the cursor says which of these happened. Machines with no recipe set, labs,
and other buildings show a hint instead. PyOps matches by recipe only. Blocks are plans,
not areas of the map, so it never guesses which of several blocks a machine belongs to.

### Capture and read tasks

The **Tasks** tab lists the project's tasks with their status and priority. Select one to
read its description, steps, and links; **Go to** moves the map view to a task's location.
**New task** captures a task anchored to your position and the entity you are hovering.

## Troubleshoot the connection

### The status remains “no game”

1. Confirm the Companion mod card says **Installed**.
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
and check its status dot, then check the bridge packet counts for activity.

::: warning Keep the bridge local
The standard bridge listens on localhost. Do not expose its UDP port to an untrusted
network.
:::
