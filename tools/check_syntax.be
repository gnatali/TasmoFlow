# Verifie la syntaxe des fichiers Berry sans les executer
# Usage : berry tools/check_syntax.be extension/*.be
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
