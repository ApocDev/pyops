# Changelog

## [1.3.0](https://github.com/ApocDev/pyops/compare/v1.2.0...v1.3.0) (2026-07-16)


### Features

* **data:** detect stale imported reference data ([952ef36](https://github.com/ApocDev/pyops/commit/952ef360a1919a653fa34470659160a63e34d570))
* **home:** prioritize actionable factory work ([493cdd4](https://github.com/ApocDev/pyops/commit/493cdd4fb5b54eaa526b891ceef9a1ad7a49ab8e))
* **planner:** add temporary production campaigns ([4de0c03](https://github.com/ApocDev/pyops/commit/4de0c03e8c85a532c988770fef68f60df6f75956))
* **scenario:** cache results and report solve progress ([0f4a1e7](https://github.com/ApocDev/pyops/commit/0f4a1e7bbdab65e2fad6c24badad0efe3fe9f5ff))
* **solver:** balance temperature-qualified factory flows ([b5b1d2b](https://github.com/ApocDev/pyops/commit/b5b1d2b1efec19fba77816280eb33f7f97c85f1f)), closes [#158](https://github.com/ApocDev/pyops/issues/158) [#159](https://github.com/ApocDev/pyops/issues/159)


### Bug Fixes

* **app:** harden dual-theme contrast ([a65de5e](https://github.com/ApocDev/pyops/commit/a65de5ede82a200ebb5c342655e5f3d46dd5f26a)), closes [#107](https://github.com/ApocDev/pyops/issues/107)
* **app:** restore home resource links ([44c5a11](https://github.com/ApocDev/pyops/commit/44c5a118a4dd70f3191e08cd2c7a4046fbf75799))
* **app:** standardize display label casing ([3b299d0](https://github.com/ApocDev/pyops/commit/3b299d0b4a4cbb9d629bbfde93fe6ae583993062))
* **block:** keep recipe controls available after solve errors ([49101e5](https://github.com/ApocDev/pyops/commit/49101e55dcea29842861a79c255ea12d47e7416e))
* **block:** keep rows stable when favoriting fuel ([97e88cc](https://github.com/ApocDev/pyops/commit/97e88cc5833f073a666940dfcfbff3ef73dce529))
* **data:** import Factorio product probabilities ([1964dfd](https://github.com/ApocDev/pyops/commit/1964dfdc9f60b2511b27758a6dd3d293bd1d80e9))

## [1.2.0](https://github.com/ApocDev/pyops/compare/v1.1.0...v1.2.0) (2026-07-14)


### Features

* **app:** add "Apply all" whole-factory re-balance to what-if ([8468486](https://github.com/ApocDev/pyops/commit/84684863031730bf9803491622038688b71dda20))
* **app:** add Alt-click recipe explorer ([66c2992](https://github.com/ApocDev/pyops/commit/66c2992f97a02b2ea6c144d1c4a164f56f6a6cc3))
* **app:** declutter the UI — controls first, explanation on demand ([0b30851](https://github.com/ApocDev/pyops/commit/0b3085110073e5b1bbf26b447aa70c99a5bae7b7))
* **app:** redesign home and navigation ([a06ff06](https://github.com/ApocDev/pyops/commit/a06ff06e64295299c302dd3b26200e177604e38f)), closes [#145](https://github.com/ApocDev/pyops/issues/145) [#146](https://github.com/ApocDev/pyops/issues/146)
* **app:** strengthen overlay separation and add segmented/info-hint primitives ([7e52675](https://github.com/ApocDev/pyops/commit/7e52675d7156989ccfffd71086315ae1b50af9a3))
* **app:** suppress native context menu ([df778e7](https://github.com/ApocDev/pyops/commit/df778e7fcd611170ca527dc2d62c104694c24bbc))
* **app:** surface Launch Factorio on the home page ([ee997b2](https://github.com/ApocDev/pyops/commit/ee997b2e907ea942e77a1673f50a47f239eeb83c))
* **app:** sushi planner for block belt loops ([eda5146](https://github.com/ApocDev/pyops/commit/eda514691b9b330ab66a75c42b7fc609864c397c))
* **block:** add best recipe goal shortcut ([8a4306e](https://github.com/ApocDev/pyops/commit/8a4306e4781d14d14bbbddcda4b0131ba7711511))
* **block:** copy and paste goals ([075d1fb](https://github.com/ApocDev/pyops/commit/075d1fbc9cbeca3c493e292c1dbce0cdf9f166dd))
* **block:** extract recipe rows into supplier blocks ([5b1ad4d](https://github.com/ApocDev/pyops/commit/5b1ad4d084610424214f0f016ee95f130a9313b8))
* **block:** extract recipe rows into supplier blocks ([38a262b](https://github.com/ApocDev/pyops/commit/38a262bc941630d06e22a726b830a3d627cb4b2d)), closes [#133](https://github.com/ApocDev/pyops/issues/133)
* **block:** flag imports without enabled suppliers ([0de20f0](https://github.com/ApocDev/pyops/commit/0de20f08d7563cf18c2287be67c265fcf9faf09d))
* **block:** model incidental spoilage as byproduct ([3230f30](https://github.com/ApocDev/pyops/commit/3230f30f19fc51c66536fc9b318b61ed248c956e))
* **block:** reorder goals with drag handles ([fb3de95](https://github.com/ApocDev/pyops/commit/fb3de95392eb0538ccabf55bd30a91d10612563a))
* **blocks:** create blocks directly in folders ([f6a8b03](https://github.com/ApocDev/pyops/commit/f6a8b03d5c1ddc912cdb13011550756a20765751))
* **block:** show loading-fit building counts ([5e29ee9](https://github.com/ApocDev/pyops/commit/5e29ee987d916c996e8ccb5a6a35f540c56160ce))
* **bridge:** deliver app-built blueprints to the game cursor ([2ba8559](https://github.com/ApocDev/pyops/commit/2ba85596d8b5936afc9b6dd69c19363fe8972d60))
* **bridge:** refresh built machines automatically ([9463820](https://github.com/ApocDev/pyops/commit/94638200580f63150950c86431b1e76fb1c64f00))
* **factory:** replace balance loop with pinned goal solver ([cee1822](https://github.com/ApocDev/pyops/commit/cee1822baa57a46009a0cadf574996e272fd5e4b))
* **mod:** in-game sushi-loop tracer (ALT+B) ([117264d](https://github.com/ApocDev/pyops/commit/117264d894521f95428e51a76f1047229882ed24))
* **planner:** add factory supply priorities ([0446569](https://github.com/ApocDev/pyops/commit/0446569e4b98c08525276e115d1590573110553c))
* **planner:** add supply priority controls ([d071a7d](https://github.com/ApocDev/pyops/commit/d071a7d2cb83598c798f55550f8ff5d122c1659d))
* **scenario:** balance factory iteratively ([c4c7435](https://github.com/ApocDev/pyops/commit/c4c74354d5510cda57ed5cb397af40f329b64385)), closes [#147](https://github.com/ApocDev/pyops/issues/147)
* **solver:** explain infeasible material balances ([3fed877](https://github.com/ApocDev/pyops/commit/3fed877aac421acf79bfdfd86c0fd8075cfc30ab))
* **solver:** prioritize factory supply allocation ([0ae6441](https://github.com/ApocDev/pyops/commit/0ae644162e1ad5c25ed86bd20402baa96bb94307))


### Bug Fixes

* **app:** clarify generator output and availability ([734dd6d](https://github.com/ApocDev/pyops/commit/734dd6d9761b37d57e6b38bc113cc7d7453f16b7))
* **app:** hide excluded module and beacon choices ([4d8cdd7](https://github.com/ApocDev/pyops/commit/4d8cdd771da6cd9d8c52a0be2471adff0e7f3de8))
* **app:** improve factory scenario readability ([eea1b59](https://github.com/ApocDev/pyops/commit/eea1b59a6d21cefff923212104791ddfe4a65c71))
* **app:** keep recipe chance visible in hover cards ([8d56880](https://github.com/ApocDev/pyops/commit/8d5688022c74085e6132480f17130983fe9a9192))
* **app:** show fluid fuel recipe icons ([2bee180](https://github.com/ApocDev/pyops/commit/2bee1801e0f62c82d3ee54afc59c86eea87dff36))
* **app:** suppress root theme hydration warning ([aa9a323](https://github.com/ApocDev/pyops/commit/aa9a32383acb84a498660a2bce8885bc598e637f))
* **app:** tighten block-balance chips ([ee2af23](https://github.com/ApocDev/pyops/commit/ee2af23f7dccf541b83255ebdfc649211b3d4ce7))
* **app:** treat sub-1% what-if scale deltas as balanced ([7cc5a1c](https://github.com/ApocDev/pyops/commit/7cc5a1c3c49acd58d203f898dff594bde0645b85))
* **block:** align goals to widest content ([e9854aa](https://github.com/ApocDev/pyops/commit/e9854aae6bbe6e581de5e2665e3eb9daeabffd5d))
* **block:** align spoilage with recipe rate ([1779c95](https://github.com/ApocDev/pyops/commit/1779c9547775c78b8136b02c6f11b329f03a346f))
* **block:** allow secondary consume goals ([7682313](https://github.com/ApocDev/pyops/commit/7682313ac82a4ee7a4dc55c7b90b35f2bbb5633a))
* **block:** distinguish consume goals from imports ([62d7a49](https://github.com/ApocDev/pyops/commit/62d7a490330572a5ecc2483387d8d56c630d5e91))
* **block:** drain selected byproduct consumers ([225fd2c](https://github.com/ApocDev/pyops/commit/225fd2c6ca85be97e15d68d727825db2fdb908f9))
* **block:** flag recipes with spoilable products ([df17962](https://github.com/ApocDev/pyops/commit/df17962e96de0fdea0498267e45e637b302c23c2))
* **block:** give stock goals a stable two-line layout ([a537c8e](https://github.com/ApocDev/pyops/commit/a537c8ec6e63b282d80b9af95dfa32e1233debda))
* **block:** keep import status inside flow chips ([e71a29f](https://github.com/ApocDev/pyops/commit/e71a29f1a13fe35e356e7969fa4e89ee23faac41))
* **block:** order imports by relevance ([056d06a](https://github.com/ApocDev/pyops/commit/056d06a0d2e3919c157d29f081dbb617c76e561e))
* **block:** process cyclic surplus into sink goals ([21c2f06](https://github.com/ApocDev/pyops/commit/21c2f06febd428d093d60e8162f5949f47928290))
* **block:** rank unlocked recipes before horizon choices ([040e690](https://github.com/ApocDev/pyops/commit/040e690ad6849f8a58c2609c5353f68a9cf7e8e2))
* **block:** send solve payloads via post ([821d2fd](https://github.com/ApocDev/pyops/commit/821d2fdec7fe2264a9930ad746d1876185c95ac9)), closes [#153](https://github.com/ApocDev/pyops/issues/153)
* **block:** show spoil times on recipe products ([7a03727](https://github.com/ApocDev/pyops/commit/7a037274723f75fa00829f9ee134812e23891740))
* **block:** size goal and flow columns to content ([e17e646](https://github.com/ApocDev/pyops/commit/e17e646844b7c55f53876c4414e7bd94fe3c9e92))
* **block:** wrap balance flows without track overflow ([2ee282a](https://github.com/ApocDev/pyops/commit/2ee282a9aa3b03613d9a0ec365f3086c22d79e95))
* **bridge:** sync exact productivity bonuses ([7442319](https://github.com/ApocDev/pyops/commit/744231931596ae15bb83f7ccb3be971c0b92b8e9)), closes [#112](https://github.com/ApocDev/pyops/issues/112)
* **bridge:** update bridge version to 4 and handle transient UDP delivery errors ([d12cada](https://github.com/ApocDev/pyops/commit/d12cada90605b86eb7517eb1857d73df11606cd2))
* **data:** restore TURD master detection ([48a8c13](https://github.com/ApocDev/pyops/commit/48a8c138819936e8b7020d6647b051f004f81d72)), closes [#143](https://github.com/ApocDev/pyops/issues/143)
* **data:** support Factorio 2.1 prototype dumps ([26862d1](https://github.com/ApocDev/pyops/commit/26862d1a72f17cca38460faea2ad868f78df8b7a))
* **db:** keep project state in SQLite ([3b5d6ab](https://github.com/ApocDev/pyops/commit/3b5d6abb6f762e35923f055f6d8cbf30733ba936))
* **db:** serialize overlapping undo actions ([a637bc9](https://github.com/ApocDev/pyops/commit/a637bc9d02581741efaa13912134c3529e70d242))
* **db:** track solve projection generations ([9581ce3](https://github.com/ApocDev/pyops/commit/9581ce3f8048fb605cc10bc16d0a2841cae5a349))
* **dev:** ignore Nitro proxy resets ([b2a3a82](https://github.com/ApocDev/pyops/commit/b2a3a82b0351a6dd1694af545863d9932a0919d3))
* **dev:** suppress aborted hot reload resets ([d9fe23a](https://github.com/ApocDev/pyops/commit/d9fe23ad70d4bde0ed656ac0983651b565158bee))
* **mod:** give the top button a slot style and crisp logo ([43b13f8](https://github.com/ApocDev/pyops/commit/43b13f8170a6f455204f326c344acb4e8805d9c9))
* **mod:** use pyops logo for mod icons ([7c34538](https://github.com/ApocDev/pyops/commit/7c34538cf7b2edbb902df2c453c3532edfbd8ffc))
* **mod:** use pyops logo for mod icons ([001d40e](https://github.com/ApocDev/pyops/commit/001d40ecc6d2cc7bc8965dc83d216a0ef9292d9e))
* **planner:** link feedback byproduct consumers ([39bf86f](https://github.com/ApocDev/pyops/commit/39bf86f08e949e2ea0799c31ceadddc363724a46))
* **scenario:** prevent sink feedback from ratcheting goals ([4cdb043](https://github.com/ApocDev/pyops/commit/4cdb043c13ba68fd70e07c1861eb629de5673816))
* **scenario:** rebalance individual block goals ([8c8ba4d](https://github.com/ApocDev/pyops/commit/8c8ba4d08087237b175e4f635d463f04a77eb382))
* **solver:** derive rates from stock goals ([ae593be](https://github.com/ApocDev/pyops/commit/ae593bee8e5f6cc3178544c4d186d5cbb16621e6))
* **solver:** honor sinks and explain scenario failures ([d3ce2df](https://github.com/ApocDev/pyops/commit/d3ce2dfe3e90e86aee627f93fabfeebb0de3b58f))
* **solver:** preserve fixed scenario boundary flows ([a681e42](https://github.com/ApocDev/pyops/commit/a681e42200c55665ee36206c6c8d696080ba1275))
* **solver:** scale goals beyond coproduct plateaus ([32ea0a5](https://github.com/ApocDev/pyops/commit/32ea0a5e866a73abad1a9b2f11ef0fa4c3328b41))
* **solver:** show recovered supply without zeroing goals ([0be3d18](https://github.com/ApocDev/pyops/commit/0be3d18dd561f9c298d1a5850caf49d610c6d19e))
* **solver:** tolerate empty legacy block docs ([d69d303](https://github.com/ApocDev/pyops/commit/d69d303ef87290b35715c1c3ed239d9ec4e5152b))
* update Factorio version requirement to 2.1 in README and info.json ([3063f3c](https://github.com/ApocDev/pyops/commit/3063f3c7cffbb1f0a345a3df450610d449ba4827))
* **whatif:** preserve input focus while solving ([42eb8ad](https://github.com/ApocDev/pyops/commit/42eb8ad6d87d653ece6c843df85852a767811689))


### Performance Improvements

* **agent:** avoid duplicate conversation rewrites ([df5e3b2](https://github.com/ApocDev/pyops/commit/df5e3b2e502108f64900b3563d642967dd376fee))
* **agent:** batch recipe option enrichment ([17d01ca](https://github.com/ApocDev/pyops/commit/17d01caf16cf47cb505ddd76fed351e41a51c77c))
* **app:** batch item availability lookups ([e6012f5](https://github.com/ApocDev/pyops/commit/e6012f51f8baf817010756b2fe672342c9af13e0))
* **app:** consolidate recurring status queries ([80fca58](https://github.com/ApocDev/pyops/commit/80fca58a8ef5f2f43e77b6a8b378933286ae207e))
* **app:** streamline server-function requests ([282f3f0](https://github.com/ApocDev/pyops/commit/282f3f0de7a259199899b15ba2433bda91806ba2))
* **block:** batch solve reference lookups ([8939bdc](https://github.com/ApocDev/pyops/commit/8939bdcbfca97564afb04214685d993889df9a62))
* **block:** replace measured goal grid with CSS ([5ace705](https://github.com/ApocDev/pyops/commit/5ace7059461d0752a11f3aeca247dd99c353c829))
* **db:** batch block and folder ordering ([6eb1ac3](https://github.com/ApocDev/pyops/commit/6eb1ac30fb87f48391ea41ff6d43ec4822cd81c6))
* **db:** batch block projection reads ([be3203b](https://github.com/ApocDev/pyops/commit/be3203ba458befb0e551335df668d985924cabe3))
* **db:** batch dependency explorer analysis ([5c33df7](https://github.com/ApocDev/pyops/commit/5c33df73b4a8f7208ece1f4d0a83eff13a453506))
* **db:** batch recipe detail queries ([bcd0bf5](https://github.com/ApocDev/pyops/commit/bcd0bf5b9adf5221e955972202ab55674c79f564))
* **db:** batch TURD planning queries ([39971e3](https://github.com/ApocDev/pyops/commit/39971e33c67a63a632f774e98770963194f74327))
* **db:** centralize SQLite connection policy ([68abc48](https://github.com/ApocDev/pyops/commit/68abc48e744e12e73f6efb677259fc73af46c5a2))
* **solver:** coalesce editor solves and saves ([e7222d8](https://github.com/ApocDev/pyops/commit/e7222d89f2bbdaf9de0870270eca60f2d20862b4))
* **solver:** reuse block solves during rebalance ([539220c](https://github.com/ApocDev/pyops/commit/539220c0644f8e58560909a3031fca70652dbb08))
* **tasks:** batch task reads and mutations ([b3c0951](https://github.com/ApocDev/pyops/commit/b3c0951f417f93763d48660e2d6178e51b69b25d))

## [1.1.0](https://github.com/ApocDev/pyops/compare/v1.0.0...v1.1.0) (2026-07-07)

### ⚠ BREAKING CHANGES

- **planner:** modules are no longer applied automatically. Rows that relied on ambient auto-fill show empty fills (with the hint) until applied — the block toolbar's sparkle button restores them in one click. The `autofill` setting now only controls hint visibility.
- **planner:** the payback-window setting is gone; module auto-fill is now a plain on/off toggle (meta key `autofill`, ON by default — previously payback 0 meant off). The old `autofill_payback` key is ignored. `chooseModuleFill` is replaced by the pure `pickAutoModules`.

### Features

- add support for Vitest in Vite config and enhance AI assistant documentation ([0e40a08](https://github.com/ApocDev/pyops/commit/0e40a08b3f777fd517609b2b2562d7f6ae5f71a0))
- **agent:** add blockBuildStatus tool for built-vs-required machines ([334cdde](https://github.com/ApocDev/pyops/commit/334cddeacb8a06043bc481703edc8ec39144f8ee)), closes [#123](https://github.com/ApocDev/pyops/issues/123)
- **agent:** add factory-wide power rollup tool ([e3dad05](https://github.com/ApocDev/pyops/commit/e3dad059ec9cdbe21b2a7188d8f4e971e78ecaeb)), closes [#129](https://github.com/ApocDev/pyops/issues/129)
- **agent:** add logisticsFor tool for belts/inserters at a rate ([34bac86](https://github.com/ApocDev/pyops/commit/34bac862a076db1e9601b4e769c5b8c222932159)), closes [#126](https://github.com/ApocDev/pyops/issues/126)
- **agent:** add productionStats tool for synced production stats ([d9fa963](https://github.com/ApocDev/pyops/commit/d9fa9631f3e69fa77580a6120a28c57069c757b9)), closes [#124](https://github.com/ApocDev/pyops/issues/124)
- **agent:** add read-only listNotes tool for planning context ([53c8173](https://github.com/ApocDev/pyops/commit/53c8173b7cd1ae9941e9b65b583ee25b6d68a070)), closes [#128](https://github.com/ApocDev/pyops/issues/128)
- **agent:** add researchPath tool for prerequisite closure + science cost ([bf0b407](https://github.com/ApocDev/pyops/commit/bf0b4078207b8fb38b6806452c0f2537a555e6bb)), closes [#125](https://github.com/ApocDev/pyops/issues/125)
- **agent:** chip technology names too; steer the assistant off Lua for recipe data ([0949f01](https://github.com/ApocDev/pyops/commit/0949f014e980161beb37e761e25f5136a24d17d2))
- **agent:** expose factoryWhatIf as a whatIf tool ([f8e7655](https://github.com/ApocDev/pyops/commit/f8e7655ef6ee3dd37483ace82412042fd62b1406)), closes [#127](https://github.com/ApocDev/pyops/issues/127)
- **agent:** implement building counts in draft and aggregate machine requirements ([00d6b32](https://github.com/ApocDev/pyops/commit/00d6b3271fdbb8d8e4b0b92d4c0d27b6406ce652))
- **agent:** multi-goal + keep-in-stock goals, and module-fill the building bill ([b8f7102](https://github.com/ApocDev/pyops/commit/b8f710206b39f80251dcc25a6d60267a227530da))
- **agent:** resolve recipeOptions' machine to the actual draft pick ([86bdc36](https://github.com/ApocDev/pyops/commit/86bdc366beee5e4c5ac39c4088e02f5846b18cc1)), closes [#130](https://github.com/ApocDev/pyops/issues/130)
- **app:** inline click-to-fix building count with color tint, no badge ([3fc1e8f](https://github.com/ApocDev/pyops/commit/3fc1e8f9d02f7f44dd9a66fdf6364a6de3285733)), closes [#121](https://github.com/ApocDev/pyops/issues/121)
- **app:** show the heat draw (MW) on heat-powered rows, not just a label ([16057f9](https://github.com/ApocDev/pyops/commit/16057f9e986ceb7c0dece3fe7a36f82e8560ff30))
- **planner:** count pin on a goal's producer supply-pushes instead of fighting the goal ([e2ff2ab](https://github.com/ApocDev/pyops/commit/e2ff2ab658a9ce1eb12baccda352fb3361b86188)), closes [#121](https://github.com/ApocDev/pyops/issues/121)
- **planner:** module auto-fill becomes suggest + explicit apply ([fdd43ca](https://github.com/ApocDev/pyops/commit/fdd43ca64ff345ac358f4201e1fa14330b107b46))
- **planner:** replace payback-economy module auto-fill with the direct algorithm ([37b47ba](https://github.com/ApocDev/pyops/commit/37b47ba1d0489a93fcbc514b41ac87b17c4e9ef9))
- **ui:** add styled Tooltip primitive, replace native title for explanatory text ([6197c83](https://github.com/ApocDev/pyops/commit/6197c83d1275862ff43c9b0e5632e879e6e69491))

### Bug Fixes

- **agent:** address review findings in assistant tool batch ([7fca79c](https://github.com/ApocDev/pyops/commit/7fca79c1d20550ba2d3df7cccb1c3ed718b2cf1d))
- **app:** a sink goal caches the consumed good once, not a duplicate import ([e9bd2fb](https://github.com/ApocDev/pyops/commit/e9bd2fb200a26d1b2e3e39d872f6da3949cc69e0))
- **app:** a sink goal is met by a consumer, not a producer — no false 'no recipe' warning ([46d3d95](https://github.com/ApocDev/pyops/commit/46d3d95d1bd654da7792f933aabdb118107febca))
- **app:** classify factory imbalances by a relative floor, not an absolute epsilon ([cc4774a](https://github.com/ApocDev/pyops/commit/cc4774aa9296e847f206de3790aaed9be4cc62ff))
- **app:** gate recipe availability on a tech's full prerequisite closure, not its own cost ([e18679d](https://github.com/ApocDev/pyops/commit/e18679db0ed0e3b8de7139c320391dbc7cc8d17a))
- **app:** size row inserters per built machine, not per fractional machine ([cce110a](https://github.com/ApocDev/pyops/commit/cce110a1e37f25bd07ff26cb51b91197f296000b)), closes [#21](https://github.com/ApocDev/pyops/issues/21)
- **bridge:** stop gating the in-game logistics readout on web display prefs ([8d4fc4f](https://github.com/ApocDev/pyops/commit/8d4fc4fdddf1d16d44d1fe2e102da81c45b99fd0)), closes [#21](https://github.com/ApocDev/pyops/issues/21)
- **mod:** make the summary panel's blueprint a temporary cursor stack ([ecc5292](https://github.com/ApocDev/pyops/commit/ecc5292b44fd1de7e28ce0ad3eb4bf6c1c47ac98))
- **planner:** drain a byproduct when its consumer is a terminal sink ([278edb1](https://github.com/ApocDev/pyops/commit/278edb192487de5186ccd62c2e647b678ba130ce)), closes [#91](https://github.com/ApocDev/pyops/issues/91)
- **planner:** hold module suggestions steady near whole-count boundaries ([b1881c7](https://github.com/ApocDev/pyops/commit/b1881c73498bb19b3a90cf5c66397ca88e9f87fe)), closes [#117](https://github.com/ApocDev/pyops/issues/117)
- **planner:** module auto-fill considers ZERO speed modules ([c112097](https://github.com/ApocDev/pyops/commit/c112097a81e81f522ce91626193f0e02c48b2649))
- **solver:** byproduct consumers no longer let the plan import-and-restructure ([138c27e](https://github.com/ApocDev/pyops/commit/138c27e2ab26fac83b42a62c000e04844ee6315c)), closes [#91](https://github.com/ApocDev/pyops/issues/91)
- **test:** type the sink-goal test's block data as saveBlockRow expects ([62f990d](https://github.com/ApocDev/pyops/commit/62f990db8ec7927e65961df0443fe43b5637e141))

### Performance Improvements

- **app:** bound the solve query cache to 30s ([bc46cfe](https://github.com/ApocDev/pyops/commit/bc46cfed1bd684fa956098e9c7c8f59de2a5e3c0))
- **planner:** batch the module-suggestion pool to one scan per solve ([60d49d5](https://github.com/ApocDev/pyops/commit/60d49d53f5f77b9e892845099154c57b902388ff)), closes [#117](https://github.com/ApocDev/pyops/issues/117)

## [1.0.0](https://github.com/ApocDev/pyops/compare/v0.5.0...v1.0.0) (2026-07-04)

### ⚠ BREAKING CHANGES

- **solver:** delete the v1 least-squares solver
- **solver:** switch the block solve to the v2 LP and the gesture-derived model

### Features

- **agent:** factory-wide coherence audit tool with byproduct disposal verdicts ([e13e9c3](https://github.com/ApocDev/pyops/commit/e13e9c354671f58547fcd88a53159a8d9108d098)), closes [#11](https://github.com/ApocDev/pyops/issues/11)
- **agent:** per-call approval gate for in-game Lua eval ([94b805b](https://github.com/ApocDev/pyops/commit/94b805b06a995509ecc91c79f316bee1da3c322f)), closes [#15](https://github.com/ApocDev/pyops/issues/15)
- **agent:** report Claude's 1M context window (GA, no beta header) ([c8eda96](https://github.com/ApocDev/pyops/commit/c8eda964eb8bdfb530ad9c7bb5a245a688e673b5)), closes [#72](https://github.com/ApocDev/pyops/issues/72)
- **agent:** reviseBlock can propose recipe-set changes, not just rate ([82b7fbd](https://github.com/ApocDev/pyops/commit/82b7fbdf285ea81abea44fd2a9c12e823f2059e7)), closes [#12](https://github.com/ApocDev/pyops/issues/12)
- **app:** add a sankey/flow view of a solved block's material flow ([95d8627](https://github.com/ApocDev/pyops/commit/95d86279290f42a2081493c2e25c858a86845d44)), closes [#101](https://github.com/ApocDev/pyops/issues/101)
- **app:** add Ctrl+K / '/' command palette ([ed95330](https://github.com/ApocDev/pyops/commit/ed9533033d868732c7561adec7c048f6a6761c91)), closes [#78](https://github.com/ApocDev/pyops/issues/78)
- **app:** add global hotkey layer (registry + useHotkey) ([ba1ec06](https://github.com/ApocDev/pyops/commit/ba1ec069c2405734ec440f82ddfbdc9a38dd4be3)), closes [#78](https://github.com/ApocDev/pyops/issues/78)
- **app:** add shared toast primitive (queue store + Toaster) ([975339c](https://github.com/ApocDev/pyops/commit/975339c795cfbd69e0b416a51a4e1286b95106f5)), closes [#90](https://github.com/ApocDev/pyops/issues/90)
- **app:** add the dependency explorer page ([256932b](https://github.com/ApocDev/pyops/commit/256932ba04b12694bdb1ae3d867fe5b2a410fec3)), closes [#100](https://github.com/ApocDev/pyops/issues/100)
- **app:** block snapshots — per-block history, restore, and diff ([004a364](https://github.com/ApocDev/pyops/commit/004a364989ec4cb982cddca11f993a846865006c)), closes [#85](https://github.com/ApocDev/pyops/issues/85)
- **app:** consistent destructive actions — confirm dialogs + undo toasts ([2eac32a](https://github.com/ApocDev/pyops/commit/2eac32a6855278fa34daa273a536b68c3d49adce)), closes [#83](https://github.com/ApocDev/pyops/issues/83)
- **app:** light/dark/system theme toggle ([#107](https://github.com/ApocDev/pyops/issues/107)) ([3c00b92](https://github.com/ApocDev/pyops/commit/3c00b92b950b429cec659a8546c48da011e50b3f))
- **app:** make PageHeader sticky on scroll ([8a45d04](https://github.com/ApocDev/pyops/commit/8a45d043819558c45e9dd4fedf0409b3679c81a2)), closes [#106](https://github.com/ApocDev/pyops/issues/106)
- **app:** match fluid-fuel MJ block-to-block with explicit suppliers ([bedf551](https://github.com/ApocDev/pyops/commit/bedf551ee1dfce648ae7560ad8b4de50f3b9f030)), closes [#115](https://github.com/ApocDev/pyops/issues/115)
- **app:** module templates — icons, compatibility filtering, defaults ([0da8069](https://github.com/ApocDev/pyops/commit/0da80696ba263a09826a3829cba1a7d733a37a4b)), closes [#99](https://github.com/ApocDev/pyops/issues/99)
- **app:** move the factory Machines card onto the sortable-table engine ([588620d](https://github.com/ApocDev/pyops/commit/588620def60d9d48212399cc16716bf97e0a08e6)), closes [#80](https://github.com/ApocDev/pyops/issues/80)
- **app:** palette goods search, recents, and the shortcut help sheet ([f2e43a7](https://github.com/ApocDev/pyops/commit/f2e43a7a2832fda4ea5c3f4eb52dd2b874b418b2)), closes [#78](https://github.com/ApocDev/pyops/issues/78)
- **app:** power units for energy rates — 5TW in, '5 GW' out ([3d776ed](https://github.com/ApocDev/pyops/commit/3d776ed5df5bf1b05594a85a6eda96d6ca5151a5))
- **app:** project backup and shareable block/plan JSON ([#82](https://github.com/ApocDev/pyops/issues/82)) ([7cfedca](https://github.com/ApocDev/pyops/commit/7cfedca83696aece777c5c80e97ea4838bff62a6))
- **app:** rank a good's producers/consumers in the browse explorer ([5c743cf](https://github.com/ApocDev/pyops/commit/5c743cfb20fe10a45ac707d59188d275657153bd)), closes [#97](https://github.com/ApocDev/pyops/issues/97)
- **app:** replace project-create prompt with a real dialog ([52be241](https://github.com/ApocDev/pyops/commit/52be2416fabb7eb15db5887b698edc2be407cdb9)), closes [#84](https://github.com/ApocDev/pyops/issues/84)
- **app:** share one filtered-list primitive across the filterable pages ([cd18c65](https://github.com/ApocDev/pyops/commit/cd18c65ddf6f880d5a3ba54151be7345596b4d6c)), closes [#87](https://github.com/ApocDev/pyops/issues/87)
- **app:** shared query/route error + loading convention ([ea1c1f6](https://github.com/ApocDev/pyops/commit/ea1c1f69d114693007bc27662c18911a97e9ac4e)), closes [#81](https://github.com/ApocDev/pyops/issues/81)
- **app:** show fluid temperatures on the recipe-grid chips ([bceea15](https://github.com/ApocDev/pyops/commit/bceea1598454837972d161a8a2822915332ab3b2)), closes [#110](https://github.com/ApocDev/pyops/issues/110)
- **app:** trigger-based undo log with grouped actions and undoLast ([08f7374](https://github.com/ApocDev/pyops/commit/08f73748978a00f83da6323c3d79c899621b30dd)), closes [#90](https://github.com/ApocDev/pyops/issues/90)
- **app:** undo UI — Ctrl+Z, nav affordance, editor rehydration ([88dbc6e](https://github.com/ApocDev/pyops/commit/88dbc6ed7bc058f59a4a11e54d6ae00387c09d28)), closes [#90](https://github.com/ApocDev/pyops/issues/90)
- **app:** warn when pending db migrations need a restart ([d9ac1d4](https://github.com/ApocDev/pyops/commit/d9ac1d46e431942d76860bbdb039f5b71392eb0d)), closes [#75](https://github.com/ApocDev/pyops/issues/75)
- **assistant:** one-click follow-up chips on draft and plan cards ([25138ad](https://github.com/ApocDev/pyops/commit/25138ad5b3bfb2ea9deb54d73d0ac590218cdd76)), closes [#13](https://github.com/ApocDev/pyops/issues/13)
- **assistant:** push a created block in-game from draft and plan cards ([8b29d11](https://github.com/ApocDev/pyops/commit/8b29d11bccce95004dec1f93d8aaa983b82b50b3)), closes [#14](https://github.com/ApocDev/pyops/issues/14)
- **db:** synthesize planting and rocket-launch recipes ([09bd667](https://github.com/ApocDev/pyops/commit/09bd667c07844f0703828b6bbbc37240789e151b)), closes [#96](https://github.com/ApocDev/pyops/issues/96)
- **planner:** fungible fluid-fuel energy pool (pyops-fluid-fuel) ([db7d65a](https://github.com/ApocDev/pyops/commit/db7d65a594d9f9f6d0ac5661de94f4c928f2dc38)), closes [#25](https://github.com/ApocDev/pyops/issues/25)
- **planner:** model temperature-fed fluid energy sources ([701fcb8](https://github.com/ApocDev/pyops/commit/701fcb8e4aa1b736260da7dbe47bd4936a9a583a)), closes [#114](https://github.com/ApocDev/pyops/issues/114)
- **solver:** apply research-driven productivity bonuses ([54972ba](https://github.com/ApocDev/pyops/commit/54972bae13ad38c8f0afe14d720503f69043c056)), closes [#92](https://github.com/ApocDev/pyops/issues/92)
- **solver:** fluid temperatures as real identities with range pooling ([708a9e0](https://github.com/ApocDev/pyops/commit/708a9e05bb38aae10a80a92c7ef0b21922071cc8)), closes [#110](https://github.com/ApocDev/pyops/issues/110)
- **solver:** model reactor neighbour bonus in heat generation ([315c25f](https://github.com/ApocDev/pyops/commit/315c25f2280deeada432b21d598175101f5a7af3)), closes [#94](https://github.com/ApocDev/pyops/issues/94)
- **solver:** sub-blocks v2 — real composition (composed modules) ([d675257](https://github.com/ApocDev/pyops/commit/d675257d75001db4a308c8936ab932b3dd518cc9)), closes [#76](https://github.com/ApocDev/pyops/issues/76)
- **solver:** switch the block solve to the v2 LP and the gesture-derived model ([21a6599](https://github.com/ApocDev/pyops/commit/21a6599bca4b5cef8587657aac2a57939e6ac81d)), closes [#91](https://github.com/ApocDev/pyops/issues/91)
- **solver:** v1 dispositions → v2 made-set migration mapping ([0da625d](https://github.com/ApocDev/pyops/commit/0da625dc0306a705967047ea650862d437a20972)), closes [#91](https://github.com/ApocDev/pyops/issues/91)
- **solver:** v2 LP core (HiGHS) and IIS root-cause diagnosis ([f22a576](https://github.com/ApocDev/pyops/commit/f22a5762fc5b836ee8bdf57315b85dad595ffd2a)), closes [#91](https://github.com/ApocDev/pyops/issues/91)
- **solver:** warn per producer on fluid-temperature mismatches ([fce65cf](https://github.com/ApocDev/pyops/commit/fce65cfcb5883226b7cb240bd4d8627c725977c5)), closes [#110](https://github.com/ApocDev/pyops/issues/110)
- **solver:** whole-machine mode (MIP), pin editor UI, and cached diagnosis ([6e0ba70](https://github.com/ApocDev/pyops/commit/6e0ba709c0acb8e43fcf98f6e2dcc9b738c8f34a)), closes [#98](https://github.com/ApocDev/pyops/issues/98) [#91](https://github.com/ApocDev/pyops/issues/91)

### Bug Fixes

- **app:** declare @tanstack/store as a direct dependency ([40065c9](https://github.com/ApocDev/pyops/commit/40065c9b17cdb6c6f29796ea4326678f169c9102))
- **app:** split block-solve display names into recipe and good namespaces ([34eb72a](https://github.com/ApocDev/pyops/commit/34eb72ac49d2b992ebbfaf6e1a0cfd41168b3fb9)), closes [#113](https://github.com/ApocDev/pyops/issues/113)
- **app:** stop the rate formatter eating integer trailing zeros — ([3d776ed](https://github.com/ApocDev/pyops/commit/3d776ed5df5bf1b05594a85a6eda96d6ca5151a5))
- **solver:** a made mark with no producer imports silently, not a nag ([51cf62f](https://github.com/ApocDev/pyops/commit/51cf62fd1988db0d152b5d41e3b38f58e3bea70b)), closes [#91](https://github.com/ApocDev/pyops/issues/91)
- **solver:** drop phantom dust flows; remove whole-machine mode; purge issue #s from UI ([e26f6dc](https://github.com/ApocDev/pyops/commit/e26f6dcfd04024ab09cd7dd3ce3dc870c31971b4)), closes [#91](https://github.com/ApocDev/pyops/issues/91)
- **solver:** honor ignored_by_productivity as a per-product amount ([acf716d](https://github.com/ApocDev/pyops/commit/acf716d1dbcc130459e2d9fcab4f379b54000b73)), closes [#93](https://github.com/ApocDev/pyops/issues/93)

### Code Refactoring

- **solver:** delete the v1 least-squares solver ([2fd5e71](https://github.com/ApocDev/pyops/commit/2fd5e71a203fe413055ca9f43c34bbb2327c33c1)), closes [#91](https://github.com/ApocDev/pyops/issues/91)

## [0.5.0](https://github.com/ApocDev/pyops/compare/v0.4.5...v0.5.0) (2026-07-02)

### Features

- **agent:** expose module-slot rules and add a what-if recipe calculator ([83cfd66](https://github.com/ApocDev/pyops/commit/83cfd66d85d413fa486e1907fc41260de00965d5))
- **app:** adaptive number precision with a compact-numbers toggle ([c0fcb87](https://github.com/ApocDev/pyops/commit/c0fcb87746ca6ced0b34ecabb03d19e10a15f88a)), closes [#74](https://github.com/ApocDev/pyops/issues/74)
- **app:** add a Launch Factorio button to the Live bridge card ([40b4c9f](https://github.com/ApocDev/pyops/commit/40b4c9f576d603e5ecaea66135266d4ff18c020a))
- **app:** add Callout, Button toggle variant, FieldLabel ([d00af1b](https://github.com/ApocDev/pyops/commit/d00af1bfc382e60e33f75b8387c2166aaa8dbedf)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** add Checkbox and DropdownMenu primitives ([45158de](https://github.com/ApocDev/pyops/commit/45158de7683bc703cec59cbc14154d9ffed52a19)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** add responsive Dialog primitive ([deee6d3](https://github.com/ApocDev/pyops/commit/deee6d3cc0e511276a14987a803a8ba22ff7385e)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** custom block icons; first goal is just the default icon ([2ad9d87](https://github.com/ApocDev/pyops/commit/2ad9d87d9a030c3678eeec58d3eadaad0d35b9a4)), closes [#40](https://github.com/ApocDev/pyops/issues/40)
- **app:** enable/disable recipes in a block and whole blocks ([86120e9](https://github.com/ApocDev/pyops/commit/86120e98a240056936d94637a659ba4e7492e490)), closes [#73](https://github.com/ApocDev/pyops/issues/73)
- **app:** enforce design-system defaults in the base layer ([dadca09](https://github.com/ApocDev/pyops/commit/dadca0933efac9616b2730bd578ae7dfb76c1e72)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** flag recipes not used by a block's goal ([1ece93f](https://github.com/ApocDev/pyops/commit/1ece93f6246a9ff211731fcac8aea6658f48ded0))
- **app:** give every icon a rich hover card instead of a native title ([9a0e9a5](https://github.com/ApocDev/pyops/commit/9a0e9a5088defec5e83ad7d25ded59df8c75da62))
- **app:** migrate Assistant page to the design system ([9d50b54](https://github.com/ApocDev/pyops/commit/9d50b546fa6cd98525fde150cde59a07397da682)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate block editor to the design system ([ad6acb3](https://github.com/ApocDev/pyops/commit/ad6acb3fca1b8048aaedb4f09bab52604b022266)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate block rail, landing, recipe card and modules modal ([2c61ff5](https://github.com/ApocDev/pyops/commit/2c61ff58088fddcda24217148eb34a9db594a2d8)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate Browse page to the design system ([8a2cbbe](https://github.com/ApocDev/pyops/commit/8a2cbbead4c37d16a5a67cd02ba2505dd3110aeb)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate Coherence page to the design system ([2feeda0](https://github.com/ApocDev/pyops/commit/2feeda029661704fba1f05dd026d51fd471ed8a9)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate Factory page to the design system ([b40516b](https://github.com/ApocDev/pyops/commit/b40516b021c093923d225e1b7446edf2217466fd)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate home page to the design system ([e985018](https://github.com/ApocDev/pyops/commit/e985018b3dac989dfc9cdbcd0bbafc8053c73b2a)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate nav shell and shared widgets to the design system ([c50666f](https://github.com/ApocDev/pyops/commit/c50666f3d338b4052b416ee86ab54041a2eb7861)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate Settings page to the design system ([20a7b43](https://github.com/ApocDev/pyops/commit/20a7b431273ae12ba1c07879d7b4ad6363ebea7f)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate Tasks page to the design system ([5cbfa7b](https://github.com/ApocDev/pyops/commit/5cbfa7bce317cbab7a35e53f4adb26ff20af9308)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate TURD page to the design system ([356382f](https://github.com/ApocDev/pyops/commit/356382f11f7b477e61e20cd035a414f08fff2fa5)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** migrate What-if page to the design system ([0d85cfd](https://github.com/ApocDev/pyops/commit/0d85cfdf4d0ec2982c20b1a58a96b35fbf6d6963)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **app:** per-goal rate windows (/s, /min, /h) and a very-low-rate warning ([8f8551a](https://github.com/ApocDev/pyops/commit/8f8551ada96873c6b817e387cdc0a7abd4fc2e11)), closes [#10](https://github.com/ApocDev/pyops/issues/10) [#38](https://github.com/ApocDev/pyops/issues/38)
- **app:** sortable, collapsible factory sections with %-met severity ([fe76d21](https://github.com/ApocDev/pyops/commit/fe76d2106bac28c61d06c6151dd082250573bb52)), closes [#77](https://github.com/ApocDev/pyops/issues/77)
- **app:** sub-blocks — collapse a recipe chain into a named group ([3d1a509](https://github.com/ApocDev/pyops/commit/3d1a509455f477ad56cfeeadb83829c0b0d17439)), closes [#7](https://github.com/ApocDev/pyops/issues/7)
- gate the TURD tab on data presence (mod-agnostic step 1) ([#69](https://github.com/ApocDev/pyops/issues/69)) ([a531dc7](https://github.com/ApocDev/pyops/commit/a531dc766116d3bed8c7db664b41c7c93915cfcd)), closes [#68](https://github.com/ApocDev/pyops/issues/68)
- **mod:** auto-detect the udp bridge and drop the enable toggle ([37193d3](https://github.com/ApocDev/pyops/commit/37193d39bc38eadb770e61dee4f0accab82339ff))
- **planner:** incidental-spoil risk flag and planned spoil losses ([bd5aa05](https://github.com/ApocDev/pyops/commit/bd5aa0556b119583751b779a9fc230d0fdc47fa0)), closes [#20](https://github.com/ApocDev/pyops/issues/20)
- **planner:** keep-in-stock goals with a refill window ([5e5300d](https://github.com/ApocDev/pyops/commit/5e5300ddffccddc30d9493f3c1b63042cf674d6d)), closes [#38](https://github.com/ApocDev/pyops/issues/38)
- **planner:** pollution budget per block, rolled up factory-wide ([d51aaa1](https://github.com/ApocDev/pyops/commit/d51aaa110f61cbcafc7375c9cfbc6783dbf0c852)), closes [#23](https://github.com/ApocDev/pyops/issues/23)
- **planner:** show the storage buffer a spoiling step needs ([79514b0](https://github.com/ApocDev/pyops/commit/79514b0c4f421a7c7516ec301d4d965d5f7b6d90)), closes [#19](https://github.com/ApocDev/pyops/issues/19)
- **solver:** pin goal-unreachable recipes to 0 instead of failing the block ([3e7438d](https://github.com/ApocDev/pyops/commit/3e7438dfc59e2ac84229d1d2b6fc32ff81b5c344))
- **turd:** show what each choice changes + recipe-comparison diffs ([#70](https://github.com/ApocDev/pyops/issues/70)) ([88e4fec](https://github.com/ApocDev/pyops/commit/88e4fece4d0e3ff74fe812902fde9f6502bb891a))

### Bug Fixes

- **agent:** report the real context window instead of the 128k fallback ([870df25](https://github.com/ApocDev/pyops/commit/870df25b4cbd25fddf2a4465618384dfb17be239))
- **app:** drop item hover cards from block nav icons ([8eac33f](https://github.com/ApocDev/pyops/commit/8eac33f3a5979ac523504d35bc5465c9ec2165cf))
- **app:** give context-menu icons room to breathe ([891dc4b](https://github.com/ApocDev/pyops/commit/891dc4b710d53b79bd4801c66b171dba3e481d12))
- **app:** navigate outside the setState updater when closing a block tab ([e14d82a](https://github.com/ApocDev/pyops/commit/e14d82a7a526c87b08d295393f76d6ff491e80ce))
- **app:** theme the scrollbars ([1eab688](https://github.com/ApocDev/pyops/commit/1eab688f7cd64bc37b8c14493d704ccf4100f324))
- **app:** tokenize the last palette stragglers ([8c5136e](https://github.com/ApocDev/pyops/commit/8c5136eab8516ff004581bf72e307dbf46cea067)), closes [#17](https://github.com/ApocDev/pyops/issues/17)
- **assistant:** pin the sidebar and composer, scroll only the messages ([5f13063](https://github.com/ApocDev/pyops/commit/5f13063c1d1359050a492baa08144179f79657df))

## [0.4.5](https://github.com/ApocDev/pyops/compare/v0.4.4...v0.4.5) (2026-07-01)

### Bug Fixes

- **app:** return an empty icon manifest before the first data sync ([#65](https://github.com/ApocDev/pyops/issues/65)) ([b34cc42](https://github.com/ApocDev/pyops/commit/b34cc4226f37f9c1f9e32e5c84dcb4f6592f90bf))

## [0.4.4](https://github.com/ApocDev/pyops/compare/v0.4.3...v0.4.4) (2026-07-01)

### Bug Fixes

- **desktop:** use the built-in updater/process plugins (fixes the ACL dead end) ([#63](https://github.com/ApocDev/pyops/issues/63)) ([fdc9800](https://github.com/ApocDev/pyops/commit/fdc980072dd0dd6b92a30e67886c925612fe7a8d))

## [0.4.3](https://github.com/ApocDev/pyops/compare/v0.4.2...v0.4.3) (2026-07-01)

### Bug Fixes

- **desktop:** kill the node sidecar before self-update restart ([#61](https://github.com/ApocDev/pyops/issues/61)) ([5b502e5](https://github.com/ApocDev/pyops/commit/5b502e50e9e878e5c7c5ed879b07c139d7fe9c49))

## [0.4.2](https://github.com/ApocDev/pyops/compare/v0.4.1...v0.4.2) (2026-07-01)

### Bug Fixes

- **desktop:** correct the updater capability URL pattern ([#59](https://github.com/ApocDev/pyops/issues/59)) ([1680dc1](https://github.com/ApocDev/pyops/commit/1680dc1dd9245d40161f6a7690c783c08ab87153))

## [0.4.1](https://github.com/ApocDev/pyops/compare/v0.4.0...v0.4.1) (2026-07-01)

### Bug Fixes

- **desktop:** grant the localhost webview IPC access so the updater works ([#57](https://github.com/ApocDev/pyops/issues/57)) ([fd1bcca](https://github.com/ApocDev/pyops/commit/fd1bcca4b668d758ba15652e0faab0a0adde06a9))

## [0.4.0](https://github.com/ApocDev/pyops/compare/v0.3.0...v0.4.0) (2026-07-01)

### Features

- **desktop:** show the release date in the update dialog ([#55](https://github.com/ApocDev/pyops/issues/55)) ([63135f7](https://github.com/ApocDev/pyops/commit/63135f7e2b8dae30a441b0043458b5db7cbcf174))

## [0.3.0](https://github.com/ApocDev/pyops/compare/v0.2.0...v0.3.0) (2026-07-01)

### Features

- **desktop:** in-app self-update prompt (toast + changelog dialog) ([#50](https://github.com/ApocDev/pyops/issues/50)) ([a0b221b](https://github.com/ApocDev/pyops/commit/a0b221bb764cba1a0b0c9e48bffaec1cd39e82da))

## [0.2.0](https://github.com/ApocDev/pyops/compare/v0.1.0...v0.2.0) (2026-06-30)

### Features

- **app:** add a GitHub link to the home page header ([ac88ba7](https://github.com/ApocDev/pyops/commit/ac88ba76e311ad2ca917a8759070be6ad2f5bcf2))
- **app:** allow tunnel hosts and bind all interfaces on the dev server ([7d5db5f](https://github.com/ApocDev/pyops/commit/7d5db5ff24daa15286384ecde64383fe93ea5a97))
- **app:** auto-select recipe when a flow has a single crafting option ([d998ba3](https://github.com/ApocDev/pyops/commit/d998ba3c4ddc3948bc3bc72861eb0237a3500b60))
- **app:** collapse global nav to a drawer below xl ([3fbe055](https://github.com/ApocDev/pyops/commit/3fbe05597d2504c7362feb5e97aaf1408ad82087))
- **app:** collapse the block sidebar into a drawer below md ([3f26ad3](https://github.com/ApocDev/pyops/commit/3f26ad3a39e8a636fbd248205a41235e0e6913a7))
- **app:** drag to reorder recipe rows in a block ([254de60](https://github.com/ApocDev/pyops/commit/254de6020356f537eb3dfda2ce58fca46aded397)), closes [#6](https://github.com/ApocDev/pyops/issues/6)
- **app:** flag block health on the sidebar, tabs, and folders ([e6c659f](https://github.com/ApocDev/pyops/commit/e6c659fae93de81e2a86661cfdfdecd61569c805))
- **app:** hide the Block Balance exports column when there are none ([f7100df](https://github.com/ApocDev/pyops/commit/f7100df307cd4ce5196f3e08b376bbfa8b35e447))
- **app:** make the settings tab rail horizontal on mobile ([360a1d4](https://github.com/ApocDev/pyops/commit/360a1d422298549cf6a8ea13037087eb99132aa0))
- **app:** move build cost into a "Building summary" slideout drawer ([5c0efe1](https://github.com/ApocDev/pyops/commit/5c0efe10bbcba522e9b1cde1bb4d80e223704aa9))
- **app:** nested sidebar folders (folders inside folders) ([9500655](https://github.com/ApocDev/pyops/commit/9500655555d2d61f36b569dff87d78820f5f1aad)), closes [#8](https://github.com/ApocDev/pyops/issues/8)
- **app:** reuse SidebarShell for the assistant chat list ([61c37e1](https://github.com/ApocDev/pyops/commit/61c37e1ed012620f0502a149a7076fb2adfacd58))
- **app:** reuse SidebarShell for the browse rail ([3de9f77](https://github.com/ApocDev/pyops/commit/3de9f776765cff01a2ca91b1493983c683808173))
- **app:** reuse SidebarShell for the tasks/notes rail ([133da22](https://github.com/ApocDev/pyops/commit/133da22c37593f5d49e0d01ff53226337f77b51b))
- **app:** show drop indicator when dragging sidebar blocks/folders ([229b89e](https://github.com/ApocDev/pyops/commit/229b89ec3a97b1581fe1b4b97f23089e3a5b5db9)), closes [#37](https://github.com/ApocDev/pyops/issues/37)
- **app:** show the data storage location in Settings ([6acb1a8](https://github.com/ApocDev/pyops/commit/6acb1a80e99c97732086d949ad50563c87dc11b6))
- **app:** tidy the Block Balance imports ([4071457](https://github.com/ApocDev/pyops/commit/4071457bccd53c445c67e115a99bf980c8b6e05c))
- **app:** touch-capable recipe-row reorder via dnd-kit ([3e4094d](https://github.com/ApocDev/pyops/commit/3e4094dbb5401ab67c1f66dbf45ebf58d7ef1336))
- **app:** touch-capable sidebar block/folder reorder via dnd-kit ([9260716](https://github.com/ApocDev/pyops/commit/9260716e081ada857ce14066f1570f797d4e0d0f))
- **bridge:** add MCP mod reload tool ([2b76ac0](https://github.com/ApocDev/pyops/commit/2b76ac0fa6d78b0ce235b8c9e81ce0de46cf8d4b))
- **data:** capture mod prototype renames and auto-apply them to blocks ([7673aa8](https://github.com/ApocDev/pyops/commit/7673aa8e29bc0e4227b41089ba054e0d37327086)), closes [#26](https://github.com/ApocDev/pyops/issues/26)
- **data:** detect a running Factorio before dumping ([6ae0717](https://github.com/ApocDev/pyops/commit/6ae07172ed8ec689402452b0a2330a3ba91af502)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
- **data:** detect mod drift and prompt an integrated re-dump ([05de0bc](https://github.com/ApocDev/pyops/commit/05de0bc19b3e2ca36d5471243df1669d0462724e)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
- **data:** guided drift + dump modal, replacing the settings-buried flow ([1dc564f](https://github.com/ApocDev/pyops/commit/1dc564f7796223ebbff354f022a1f643e9219f71)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
- **data:** persist and display the project's mod list with versions ([0ef9f3c](https://github.com/ApocDev/pyops/commit/0ef9f3cbe25894e6959662d259b4cb51d9080a78)), closes [#28](https://github.com/ApocDev/pyops/issues/28)
- **desktop:** add a Tauri desktop shell that runs the app in a window ([01eb659](https://github.com/ApocDev/pyops/commit/01eb6593bb9fe50f024a341af5fa53ded0171b10))
- **desktop:** bundle a vendored node sidecar so the app runs standalone ([7dc1862](https://github.com/ApocDev/pyops/commit/7dc18626877c0cde085f29ac4e60813b05bf0e54))
- **desktop:** check for updates on launch and prompt to install ([af78669](https://github.com/ApocDev/pyops/commit/af7866913f80a9e3d3e50965c5aef3ba59b4cc44))
- **desktop:** enforce a single instance for stability ([bc94b4b](https://github.com/ApocDev/pyops/commit/bc94b4be6a91cfcc89de2205100b314be36810d4)), closes [#41](https://github.com/ApocDev/pyops/issues/41)
- **desktop:** open external links in the system browser ([8c98fcf](https://github.com/ApocDev/pyops/commit/8c98fcf565444dcee26078de3afad45c8030e96f))
- **desktop:** polish the window — version title, icons, size, geometry ([755e51e](https://github.com/ApocDev/pyops/commit/755e51e4605d20e1d6d073891ac315c3a63c5d8d))
- **logistics:** belts & inserters/loaders per block row ([#21](https://github.com/ApocDev/pyops/issues/21)) ([cd39fd0](https://github.com/ApocDev/pyops/commit/cd39fd02fc4ed9406da377dd945b0b248917099d))
- **logistics:** independent show toggles for belts, inserters, rockets ([efd27b3](https://github.com/ApocDev/pyops/commit/efd27b333c8135d1190417e0096c2a601dab1603)), closes [#21](https://github.com/ApocDev/pyops/issues/21)
- **logistics:** rocket launches/min per good ([#22](https://github.com/ApocDev/pyops/issues/22)) ([2b7d1be](https://github.com/ApocDev/pyops/commit/2b7d1be8ad20505d7b88c2e364169633a94b7fa0))
- **mod:** Helmod-style in-game summary with logistics, fuel & colored cards ([220fe3b](https://github.com/ApocDev/pyops/commit/220fe3b20e6cb64b23c19f3da1691231530d567e))
- **planner:** degrade gracefully for blocks with missing recipes/items ([377110d](https://github.com/ApocDev/pyops/commit/377110d66633e95b5e0dacf8028f163a26231af3)), closes [#1](https://github.com/ApocDev/pyops/issues/1)
- **planner:** per-product goal rates (multiple targets per block) ([da03bca](https://github.com/ApocDev/pyops/commit/da03bca6877670b96f9e369c3d5d84ab93b97e9b)), closes [#36](https://github.com/ApocDev/pyops/issues/36)
- **planner:** preferred defaults (favorites) for machines & fuel ([93de9d8](https://github.com/ApocDev/pyops/commit/93de9d8f81654a27764cf3c76fe8473f1f174579)), closes [#18](https://github.com/ApocDev/pyops/issues/18)
- **planner:** show a block's one-time build cost (capital materials) ([9460008](https://github.com/ApocDev/pyops/commit/9460008f482ee0c52b65a2b41ddf2981c60f5045)), closes [#38](https://github.com/ApocDev/pyops/issues/38)

### Bug Fixes

- **app:** add a version field to package.json for release-please ([4ba57c6](https://github.com/ApocDev/pyops/commit/4ba57c6951063177e8718184f8119627c5cf5667))
- **app:** don't close the sidebar drawer when switching in-drawer tabs ([5f5ef8f](https://github.com/ApocDev/pyops/commit/5f5ef8fb4a5d4e2132a58b4eb906f0f0042d64cd))
- **app:** give browse recipe names their own line on mobile ([b7fffef](https://github.com/ApocDev/pyops/commit/b7fffefff0e7b3314e54d9122bc13d658e519da7))
- **app:** keep hover tooltips fully on-screen ([a5b2862](https://github.com/ApocDev/pyops/commit/a5b286288cbc5130d77ae1a3053149e2a46399a6))
- **app:** keep the assistant composer toolbar on one line on mobile ([c499398](https://github.com/ApocDev/pyops/commit/c499398bc128a3bd4c878fa1d0338250f2bdc757))
- **app:** replace emoji/symbol glyphs with Lucide icons across the UI ([fb50e9a](https://github.com/ApocDev/pyops/commit/fb50e9a89ae877c94d1ce3437de07aaf5701d1fb))
- **app:** show full block names in coherence chips on mobile ([47565af](https://github.com/ApocDev/pyops/commit/47565af0c4b9b82318aaef67e06bc9de27a23211))
- **app:** show the full nav bar only once it fits (~1400px) ([3b8d143](https://github.com/ApocDev/pyops/commit/3b8d143c642b7d4a18b3144b337051d66ddf891a))
- **app:** stack factory balance rows on mobile for readable names ([ea38c1c](https://github.com/ApocDev/pyops/commit/ea38c1c7ac395baa8b14c6a8e628b74f3ad5ab4a))
- **app:** stack the block recipe grid on mobile ([8ade275](https://github.com/ApocDev/pyops/commit/8ade275fa9eaacefbc5c2b8920e30b0f799644ff))
- **app:** stack the factory machine table on mobile too ([dac251e](https://github.com/ApocDev/pyops/commit/dac251e4268095b928ff2d723526616fd8b52078))
- **app:** stack the whatif block-changes table on mobile ([15c20c6](https://github.com/ApocDev/pyops/commit/15c20c644728815f2c0edd7737bdee47461d892b))
- **app:** wrap the turd upgrade icon strip on mobile ([3dd521d](https://github.com/ApocDev/pyops/commit/3dd521d3adb53270c0a29833a05ec2fe4b6b75fa))
- **data:** clearer sync-modal copy, active-step spinner, running-game guard ([f03c994](https://github.com/ApocDev/pyops/commit/f03c9945a4fc6546783d97c5adf546b18d7c3dd8)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
- **data:** scroll the drift change-list when it gets long ([8705e32](https://github.com/ApocDev/pyops/commit/8705e32ba6d478e573a6c5ec463a360add64e8d8)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
- **data:** use an ArrowRight icon for version-change drift chips ([d81d86f](https://github.com/ApocDev/pyops/commit/d81d86f30ced3b090813a103366e80e224f9261a)), closes [#27](https://github.com/ApocDev/pyops/issues/27)
- ensure TanStackDevtools hides until hover ([118ad5b](https://github.com/ApocDev/pyops/commit/118ad5bcd211deeb9d84608ddc4bfb3b1cf2efe8))
- **solver:** keep a block solvable when a goal has no recipe ([6b294d1](https://github.com/ApocDev/pyops/commit/6b294d11295193f2cb7530ce94f259b6d3266981))
