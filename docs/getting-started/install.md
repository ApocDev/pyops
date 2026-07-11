---
title: Install PyOps
description: Choose and install the current PyOps desktop build for Windows, Linux, or macOS.
---

# Install PyOps

PyOps is a local desktop application. Download the current build from the
[latest GitHub release](https://github.com/ApocDev/pyops/releases/latest), then choose the
file for your operating system.

| Platform            | Download                 | Notes                                                                                 |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| Windows x64         | `PyOps_*_x64-setup.exe`  | Run the installer. Installed builds can update themselves.                            |
| Linux x64           | `PyOps_*_amd64.AppImage` | Recommended. Make it executable and run it; supports in-app updates.                  |
| Debian/Ubuntu x64   | `PyOps_*_amd64.deb`      | Installs through the system package manager; update it by installing a newer package. |
| macOS Apple Silicon | `PyOps_*_aarch64.dmg`    | For M-series Macs. Drag PyOps into Applications.                                      |
| macOS Intel         | `PyOps_*_x64.dmg`        | For Intel Macs. Drag PyOps into Applications.                                         |

::: tip Which Mac do I have?
Open **Apple menu → About This Mac**. Choose the Apple Silicon build when **Chip** starts
with Apple M; choose the Intel build when the dialog shows an Intel **Processor**.
:::

## Linux AppImage

Make the downloaded file executable, then open it:

```sh
chmod +x PyOps_*_amd64.AppImage
./PyOps_*_amd64.AppImage
```

If your system does not provide FUSE, run the AppImage without mounting it:

```sh
./PyOps_*_amd64.AppImage --appimage-extract-and-run
```

::: warning Prefer the AppImage when you want automatic updates
The `.deb` build does not update itself. Download and install each new `.deb` release
manually, or use the AppImage instead.
:::

## First launch

PyOps opens its local application window and creates its app-level configuration. A new
project contains no Factorio recipes or items yet; that is expected. Continue to
[Choose or create a project](./project).
