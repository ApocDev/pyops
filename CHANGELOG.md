# Changelog

## [0.4.4](https://github.com/ApocDev/pyops/compare/v0.4.3...v0.4.4) (2026-07-01)


### Bug Fixes

* **desktop:** use the built-in updater/process plugins (fixes the ACL dead end) ([#63](https://github.com/ApocDev/pyops/issues/63)) ([fdc9800](https://github.com/ApocDev/pyops/commit/fdc980072dd0dd6b92a30e67886c925612fe7a8d))

## [0.4.3](https://github.com/ApocDev/pyops/compare/v0.4.2...v0.4.3) (2026-07-01)


### Bug Fixes

* **desktop:** kill the node sidecar before self-update restart ([#61](https://github.com/ApocDev/pyops/issues/61)) ([5b502e5](https://github.com/ApocDev/pyops/commit/5b502e50e9e878e5c7c5ed879b07c139d7fe9c49))

## [0.4.2](https://github.com/ApocDev/pyops/compare/v0.4.1...v0.4.2) (2026-07-01)


### Bug Fixes

* **desktop:** correct the updater capability URL pattern ([#59](https://github.com/ApocDev/pyops/issues/59)) ([1680dc1](https://github.com/ApocDev/pyops/commit/1680dc1dd9245d40161f6a7690c783c08ab87153))

## [0.4.1](https://github.com/ApocDev/pyops/compare/v0.4.0...v0.4.1) (2026-07-01)


### Bug Fixes

* **desktop:** grant the localhost webview IPC access so the updater works ([#57](https://github.com/ApocDev/pyops/issues/57)) ([fd1bcca](https://github.com/ApocDev/pyops/commit/fd1bcca4b668d758ba15652e0faab0a0adde06a9))

## [0.4.0](https://github.com/ApocDev/pyops/compare/v0.3.0...v0.4.0) (2026-07-01)


### Features

* **desktop:** show the release date in the update dialog ([#55](https://github.com/ApocDev/pyops/issues/55)) ([63135f7](https://github.com/ApocDev/pyops/commit/63135f7e2b8dae30a441b0043458b5db7cbcf174))

## [0.3.0](https://github.com/ApocDev/pyops/compare/v0.2.0...v0.3.0) (2026-07-01)


### Features

* **desktop:** in-app self-update prompt (toast + changelog dialog) ([#50](https://github.com/ApocDev/pyops/issues/50)) ([a0b221b](https://github.com/ApocDev/pyops/commit/a0b221bb764cba1a0b0c9e48bffaec1cd39e82da))

## [0.2.0](https://github.com/ApocDev/pyops/compare/v0.1.0...v0.2.0) (2026-06-30)


### Features

* **app:** add a GitHub link to the home page header ([ac88ba7](https://github.com/ApocDev/pyops/commit/ac88ba76e311ad2ca917a8759070be6ad2f5bcf2))
* **app:** allow tunnel hosts and bind all interfaces on the dev server ([7d5db5f](https://github.com/ApocDev/pyops/commit/7d5db5ff24daa15286384ecde64383fe93ea5a97))
* **app:** auto-select recipe when a flow has a single crafting option ([d998ba3](https://github.com/ApocDev/pyops/commit/d998ba3c4ddc3948bc3bc72861eb0237a3500b60))
* **app:** collapse global nav to a drawer below xl ([3fbe055](https://github.com/ApocDev/pyops/commit/3fbe05597d2504c7362feb5e97aaf1408ad82087))
* **app:** collapse the block sidebar into a drawer below md ([3f26ad3](https://github.com/ApocDev/pyops/commit/3f26ad3a39e8a636fbd248205a41235e0e6913a7))
* **app:** drag to reorder recipe rows in a block ([254de60](https://github.com/ApocDev/pyops/commit/254de6020356f537eb3dfda2ce58fca46aded397)), closes [#6](https://github.com/ApocDev/pyops/issues/6)
* **app:** flag block health on the sidebar, tabs, and folders ([e6c659f](https://github.com/ApocDev/pyops/commit/e6c659fae93de81e2a86661cfdfdecd61569c805))
* **app:** hide the Block Balance exports column when there are none ([f7100df](https://github.com/ApocDev/pyops/commit/f7100df307cd4ce5196f3e08b376bbfa8b35e447))
* **app:** make the settings tab rail horizontal on mobile ([360a1d4](https://github.com/ApocDev/pyops/commit/360a1d422298549cf6a8ea13037087eb99132aa0))
* **app:** move build cost into a "Building summary" slideout drawer ([5c0efe1](https://github.com/ApocDev/pyops/commit/5c0efe10bbcba522e9b1cde1bb4d80e223704aa9))
* **app:** nested sidebar folders (folders inside folders) ([9500655](https://github.com/ApocDev/pyops/commit/9500655555d2d61f36b569dff87d78820f5f1aad)), closes [#8](https://github.com/ApocDev/pyops/issues/8)
* **app:** reuse SidebarShell for the assistant chat list ([61c37e1](https://github.com/ApocDev/pyops/commit/61c37e1ed012620f0502a149a7076fb2adfacd58))
* **app:** reuse SidebarShell for the browse rail ([3de9f77](https://github.com/ApocDev/pyops/commit/3de9f776765cff01a2ca91b1493983c683808173))
* **app:** reuse SidebarShell for the tasks/notes rail ([133da22](https://github.com/ApocDev/pyops/commit/133da22c37593f5d49e0d01ff53226337f77b51b))
* **app:** show drop indicator when dragging sidebar blocks/folders ([229b89e](https://github.com/ApocDev/pyops/commit/229b89ec3a97b1581fe1b4b97f23089e3a5b5db9)), closes [#37](https://github.com/ApocDev/pyops/issues/37)
* **app:** show the data storage location in Settings ([6acb1a8](https://github.com/ApocDev/pyops/commit/6acb1a80e99c97732086d949ad50563c87dc11b6))
* **app:** tidy the Block Balance imports ([4071457](https://github.com/ApocDev/pyops/commit/4071457bccd53c445c67e115a99bf980c8b6e05c))
* **app:** touch-capable recipe-row reorder via dnd-kit ([3e4094d](https://github.com/ApocDev/pyops/commit/3e4094dbb5401ab67c1f66dbf45ebf58d7ef1336))
* **app:** touch-capable sidebar block/folder reorder via dnd-kit ([9260716](https://github.com/ApocDev/pyops/commit/9260716e081ada857ce14066f1570f797d4e0d0f))
* **bridge:** add MCP mod reload tool ([2b76ac0](https://github.com/ApocDev/pyops/commit/2b76ac0fa6d78b0ce235b8c9e81ce0de46cf8d4b))
* **data:** capture mod prototype renames and auto-apply them to blocks ([7673aa8](https://github.com/ApocDev/pyops/commit/7673aa8e29bc0e4227b41089ba054e0d37327086)), closes [#26](https://github.com/ApocDev/pyops/issues/26)
* **data:** detect a running Factorio before dumping ([6ae0717](https://github.com/ApocDev/pyops/commit/6ae07172ed8ec689402452b0a2330a3ba91af502)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
* **data:** detect mod drift and prompt an integrated re-dump ([05de0bc](https://github.com/ApocDev/pyops/commit/05de0bc19b3e2ca36d5471243df1669d0462724e)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
* **data:** guided drift + dump modal, replacing the settings-buried flow ([1dc564f](https://github.com/ApocDev/pyops/commit/1dc564f7796223ebbff354f022a1f643e9219f71)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
* **data:** persist and display the project's mod list with versions ([0ef9f3c](https://github.com/ApocDev/pyops/commit/0ef9f3cbe25894e6959662d259b4cb51d9080a78)), closes [#28](https://github.com/ApocDev/pyops/issues/28)
* **desktop:** add a Tauri desktop shell that runs the app in a window ([01eb659](https://github.com/ApocDev/pyops/commit/01eb6593bb9fe50f024a341af5fa53ded0171b10))
* **desktop:** bundle a vendored node sidecar so the app runs standalone ([7dc1862](https://github.com/ApocDev/pyops/commit/7dc18626877c0cde085f29ac4e60813b05bf0e54))
* **desktop:** check for updates on launch and prompt to install ([af78669](https://github.com/ApocDev/pyops/commit/af7866913f80a9e3d3e50965c5aef3ba59b4cc44))
* **desktop:** enforce a single instance for stability ([bc94b4b](https://github.com/ApocDev/pyops/commit/bc94b4be6a91cfcc89de2205100b314be36810d4)), closes [#41](https://github.com/ApocDev/pyops/issues/41)
* **desktop:** open external links in the system browser ([8c98fcf](https://github.com/ApocDev/pyops/commit/8c98fcf565444dcee26078de3afad45c8030e96f))
* **desktop:** polish the window — version title, icons, size, geometry ([755e51e](https://github.com/ApocDev/pyops/commit/755e51e4605d20e1d6d073891ac315c3a63c5d8d))
* **logistics:** belts & inserters/loaders per block row ([#21](https://github.com/ApocDev/pyops/issues/21)) ([cd39fd0](https://github.com/ApocDev/pyops/commit/cd39fd02fc4ed9406da377dd945b0b248917099d))
* **logistics:** independent show toggles for belts, inserters, rockets ([efd27b3](https://github.com/ApocDev/pyops/commit/efd27b333c8135d1190417e0096c2a601dab1603)), closes [#21](https://github.com/ApocDev/pyops/issues/21)
* **logistics:** rocket launches/min per good ([#22](https://github.com/ApocDev/pyops/issues/22)) ([2b7d1be](https://github.com/ApocDev/pyops/commit/2b7d1be8ad20505d7b88c2e364169633a94b7fa0))
* **mod:** Helmod-style in-game summary with logistics, fuel & colored cards ([220fe3b](https://github.com/ApocDev/pyops/commit/220fe3b20e6cb64b23c19f3da1691231530d567e))
* **planner:** degrade gracefully for blocks with missing recipes/items ([377110d](https://github.com/ApocDev/pyops/commit/377110d66633e95b5e0dacf8028f163a26231af3)), closes [#1](https://github.com/ApocDev/pyops/issues/1)
* **planner:** per-product goal rates (multiple targets per block) ([da03bca](https://github.com/ApocDev/pyops/commit/da03bca6877670b96f9e369c3d5d84ab93b97e9b)), closes [#36](https://github.com/ApocDev/pyops/issues/36)
* **planner:** preferred defaults (favorites) for machines & fuel ([93de9d8](https://github.com/ApocDev/pyops/commit/93de9d8f81654a27764cf3c76fe8473f1f174579)), closes [#18](https://github.com/ApocDev/pyops/issues/18)
* **planner:** show a block's one-time build cost (capital materials) ([9460008](https://github.com/ApocDev/pyops/commit/9460008f482ee0c52b65a2b41ddf2981c60f5045)), closes [#38](https://github.com/ApocDev/pyops/issues/38)


### Bug Fixes

* **app:** add a version field to package.json for release-please ([4ba57c6](https://github.com/ApocDev/pyops/commit/4ba57c6951063177e8718184f8119627c5cf5667))
* **app:** don't close the sidebar drawer when switching in-drawer tabs ([5f5ef8f](https://github.com/ApocDev/pyops/commit/5f5ef8fb4a5d4e2132a58b4eb906f0f0042d64cd))
* **app:** give browse recipe names their own line on mobile ([b7fffef](https://github.com/ApocDev/pyops/commit/b7fffefff0e7b3314e54d9122bc13d658e519da7))
* **app:** keep hover tooltips fully on-screen ([a5b2862](https://github.com/ApocDev/pyops/commit/a5b286288cbc5130d77ae1a3053149e2a46399a6))
* **app:** keep the assistant composer toolbar on one line on mobile ([c499398](https://github.com/ApocDev/pyops/commit/c499398bc128a3bd4c878fa1d0338250f2bdc757))
* **app:** replace emoji/symbol glyphs with Lucide icons across the UI ([fb50e9a](https://github.com/ApocDev/pyops/commit/fb50e9a89ae877c94d1ce3437de07aaf5701d1fb))
* **app:** show full block names in coherence chips on mobile ([47565af](https://github.com/ApocDev/pyops/commit/47565af0c4b9b82318aaef67e06bc9de27a23211))
* **app:** show the full nav bar only once it fits (~1400px) ([3b8d143](https://github.com/ApocDev/pyops/commit/3b8d143c642b7d4a18b3144b337051d66ddf891a))
* **app:** stack factory balance rows on mobile for readable names ([ea38c1c](https://github.com/ApocDev/pyops/commit/ea38c1c7ac395baa8b14c6a8e628b74f3ad5ab4a))
* **app:** stack the block recipe grid on mobile ([8ade275](https://github.com/ApocDev/pyops/commit/8ade275fa9eaacefbc5c2b8920e30b0f799644ff))
* **app:** stack the factory machine table on mobile too ([dac251e](https://github.com/ApocDev/pyops/commit/dac251e4268095b928ff2d723526616fd8b52078))
* **app:** stack the whatif block-changes table on mobile ([15c20c6](https://github.com/ApocDev/pyops/commit/15c20c644728815f2c0edd7737bdee47461d892b))
* **app:** wrap the turd upgrade icon strip on mobile ([3dd521d](https://github.com/ApocDev/pyops/commit/3dd521d3adb53270c0a29833a05ec2fe4b6b75fa))
* **data:** clearer sync-modal copy, active-step spinner, running-game guard ([f03c994](https://github.com/ApocDev/pyops/commit/f03c9945a4fc6546783d97c5adf546b18d7c3dd8)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
* **data:** scroll the drift change-list when it gets long ([8705e32](https://github.com/ApocDev/pyops/commit/8705e32ba6d478e573a6c5ec463a360add64e8d8)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
* **data:** use an ArrowRight icon for version-change drift chips ([d81d86f](https://github.com/ApocDev/pyops/commit/d81d86f30ced3b090813a103366e80e224f9261a)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
* ensure TanStackDevtools hides until hover ([118ad5b](https://github.com/ApocDev/pyops/commit/118ad5bcd211deeb9d84608ddc4bfb3b1cf2efe8))
* **solver:** keep a block solvable when a goal has no recipe ([6b294d1](https://github.com/ApocDev/pyops/commit/6b294d11295193f2cb7530ce94f259b6d3266981))
