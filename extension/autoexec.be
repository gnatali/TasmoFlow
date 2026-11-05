# TasmoFlow : point d'entree de la .tapp (assemblee par tools/pack_tapp.py)
do                          # dans un bloc `do` pour ne rien ajouter a l'espace global
  import introspect
  var tasmoflow = introspect.module('tasmoflow', true)     # charge le module sans le mettre en cache
  tasmota.add_extension(tasmoflow)
end

# pour decharger : tasmota.unload_extension('TasmoFlow')
