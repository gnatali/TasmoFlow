# TasmoFlow: entry point of the .tapp (built by tools/pack_tapp.py)
do                          # inside a `do` block so nothing is added to the global namespace
  import introspect
  var tasmoflow = introspect.module('tasmoflow', true)     # load the module without caching it
  tasmota.add_extension(tasmoflow)
end

# to unload: tasmota.unload_extension('TasmoFlow')
