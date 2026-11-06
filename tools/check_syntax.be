# Verifie la syntaxe des fichiers Berry sans les executer
# Usage : berry tools/check_syntax.be extension/*.be
#
# L'interpreteur Berry standard refuse de compiler un nom global inconnu : on declare
# d'abord les globales que le firmware Tasmota fournit vraiment. Ne jamais y ajouter un
# module qui s'importe (re, json, string...) : cela masquerait un `import` manquant.
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
    print("ERREUR  " + path + " : " + str(m))
    ok = false
  end
end
if !ok
  raise "syntax_error", "erreur de syntaxe Berry"
end
