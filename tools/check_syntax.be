# Checks the syntax of Berry files without running them
# Usage : berry tools/check_syntax.be extension/*.be
#
# The standard Berry interpreter refuses to compile an unknown global name: first declare
# the globals that the Tasmota firmware really provides. Never add a module that is
# imported (re, json, string...): it would hide a missing `import`.
import global
global.tasmota = true
global.log = true
global.tcpserver = true
global.format = true

var ok = true
for path: _argv[1 ..]
  var f = open(path)
  var src = f.read()
  f.close()
  try
    compile(src)
    print("ok      " + path)
  except .. as e, m
    print("ERROR   " + path + " : " + str(m))
    ok = false
  end
end
if !ok
  raise "syntax_error", "Berry syntax error"
end
