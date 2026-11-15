# gametest

In-game tests: Factorio measures its own numbers, and Vitest checks PyOps's math
against them.

```sh
node gametest/run.ts update [suite...]   # lock the newest mods
node gametest/run.ts run [suite...]      # measure, write results/<suite>.json
```

How it works, how to add a case, and how mod versions are locked:
[docs/development/gametest.md](../docs/development/gametest.md).
