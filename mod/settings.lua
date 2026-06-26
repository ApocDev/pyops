data:extend({
  {
    type = "bool-setting",
    name = "pyops-bridge-enabled",
    setting_type = "runtime-per-user",
    default_value = false,
    order = "a"
  },
  {
    type = "int-setting",
    name = "pyops-bridge-port",
    setting_type = "runtime-per-user",
    default_value = 37657,
    minimum_value = 1,
    maximum_value = 65535,
    order = "b"
  },
  {
    type = "bool-setting",
    name = "pyops-debug-log-events",
    setting_type = "runtime-per-user",
    default_value = false,
    order = "c"
  }
})
