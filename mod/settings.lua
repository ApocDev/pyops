data:extend({
  {
    type = "int-setting",
    name = "pyops-bridge-port",
    setting_type = "runtime-per-user",
    default_value = 37657,
    minimum_value = 1,
    maximum_value = 65535,
    order = "a"
  },
  {
    -- Kill switch for app-driven Lua eval (cmd.eval), defense in depth behind
    -- the app's per-call approval UI (#15). Off = the mod refuses every eval
    -- (this also disables the app's screenshot capture, which rides on eval).
    type = "bool-setting",
    name = "pyops-allow-eval",
    setting_type = "runtime-per-user",
    default_value = true,
    order = "b"
  }
})
