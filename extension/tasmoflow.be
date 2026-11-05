###################################################################################
# tasmoflow.be - TasmoFlow, interface web sans code pour passerelle Zigbee Tasmota
#
# SPDX-License-Identifier: GPL-3.0-only
###################################################################################
# Prototype v0.0. Deux serveurs :
#
# - port 80, serveur web de Tasmota : bouton « TasmoFlow » dans le menu principal et
#   page /tf, protegee par le mot de passe web, qui charge l'interface depuis GitHub
#   Pages (version figee, empreinte SRI) ou, a defaut, depuis la copie locale.
#
# - port 8384, serveur asynchrone Berry (tf_http.be) : API JSON, flux d'evenements
#   (Server-Sent Events) et copie locale de l'interface. Le serveur principal ne
#   permet pas d'ajouter d'en-tetes HTTP depuis Berry (ni CORS, ni Content-Encoding) :
#   ce second port le permet sans recompiler le firmware.
#
# Les routes de l'API exigent le jeton `t`, cree au premier demarrage et transmis
# uniquement par la page /tf.
#
# Les @@...@@ sont remplaces par tools/pack_tapp.py.
###################################################################################

import webserver
import string
import json
import tf_http

#----------------------------------------------------------------------------------
# Envoi d'un fichier par morceaux de 1 Ko, au rythme du client : la copie locale de
# l'interface (environ 100 Ko) ne doit jamais etre chargee d'un bloc en RAM.
#----------------------------------------------------------------------------------
class tf_streamer
  var cnx, f, cb

  def init(cnx, f)
    self.cnx = cnx
    self.f = f
    self.cb = / -> self.loop()
    tasmota.add_fast_loop(self.cb)
  end

  def loop()
    if !self.cnx.connected()    self.stop()   return  end
    if !self.cnx.buf_out_empty()   return   end
    var b = self.f.readbytes(1024)
    if size(b) == 0
      self.cnx.content_stop()
      self.stop()
    else
      self.cnx.write(b)
    end
  end

  def stop()
    tasmota.remove_fast_loop(self.cb)
    if self.f != nil    self.f.close()    self.f = nil    end
  end
end

#----------------------------------------------------------------------------------
class tasmoflow
  static var VERSION = "@@VERSION@@"
  static var CDN = "@@CDN@@"            # adresse GitHub Pages ('' = copie locale seule)
  static var SRI = "@@SRI@@"            # empreinte SRI (sha384) de app.js
  static var PORT = 8384
  static var MAX_EVENTS = 50            # evenements gardes pour les clients qui se reconnectent
  static var MAX_FEEDS = 3              # flux d'evenements ouverts en meme temps

  var wd                                # dossier de la .tapp, ex. '/.extensions/TasmoFlow.tapp#'
  var web                               # serveur tf_http du port 8384
  var token
  var events                            # [ [seq, texte SSE], ... ]
  var seq
  var feeds                             # connexions SSE ouvertes
  var ping
  var routes_added

  def init()
    self.wd = tasmota.wd
    self.events = []
    self.seq = 0
    self.feeds = []
    self.ping = 0
    self.routes_added = false
    self.token = self.load_token()

    var zb = self.zb()
    if zb != nil    zb.add_handler(self)    end
    tasmota.add_driver(self)

    if tasmota.is_network_up()
      self.init_network()
      # extension installee a chaud : Tasmota n'enverra plus l'evenement web_add_handler
      if webserver.state() != 0   self.web_add_handler()   end
    else
      tasmota.when_network_up(/ -> self.init_network())
    end
  end

  def unload()
    var zb = self.zb()
    if zb != nil    zb.remove_handler(self)    end
    for f: self.feeds   f.close()   end
    self.feeds = []
    if self.web != nil    self.web.close()    self.web = nil    end
    if self.routes_added    webserver.remove_route("/tf", webserver.HTTP_GET)    end
    tasmota.remove_driver(self)
  end

  #--------------------------------------------------------------------------------
  # Outils
  #--------------------------------------------------------------------------------
  static def zb()
    import global
    return global.contains('zigbee') ? global.zigbee : nil
  end

  static def load_token()
    import persist
    var t = persist.find('tasmoflow_token')
    if t == nil
      import crypto
      t = crypto.random(16).tohex()
      persist.tasmoflow_token = t
      persist.save()
    end
    return t
  end

  static def urldecode(s)
    var b = bytes()
    var i = 0
    var n = size(s)
    while i < n
      var c = s[i]
      if c == '+'
        b.append(' ')
      elif c == '%' && i + 2 < n
        b.add(int('0x' + s[i + 1 .. i + 2]), 1)
        i += 2
      else
        b.append(c)
      end
      i += 1
    end
    return b.asstring()
  end

  static def parse_query(uri)
    var q = {}
    var i = string.find(uri, '?')
    if i < 0    return q    end
    for kv: string.split(uri[i + 1 ..], '&')
      if size(kv) == 0    continue    end
      var j = string.find(kv, '=')
      if j < 0
        q[_class.urldecode(kv)] = ''
      elif j == 0
        continue
      else
        q[_class.urldecode(kv[0 .. j - 1])] = _class.urldecode(kv[j + 1 ..])
      end
    end
    return q
  end

  # valeur d'une commande Tasmota, ou nil
  static def cmdv(cmd, key)
    var r = tasmota.cmd(cmd, true)
    return r != nil ? r.find(key) : nil
  end

  def send_json(cnx, code, s)
    cnx.send(code, "application/json", s)
    cnx.content_stop()
  end

  # renvoie la requete decodee, ou nil (et repond 403) si le jeton manque
  def authorized(cnx, uri)
    var q = self.parse_query(uri)
    if q.find('t') == self.token    return q    end
    self.send_json(cnx, 403, '{"error":"token"}')
    return nil
  end

  #--------------------------------------------------------------------------------
  # Port 80 : bouton et page /tf
  #--------------------------------------------------------------------------------
  def web_add_main_button()
    webserver.content_send("<p></p><form id=but_tasmoflow style='display: block;' action='tf' method='get'><button>TasmoFlow</button></form>")
  end

  def web_add_handler()
    if self.routes_added    return    end
    webserver.on("/tf", / -> self.page_tf(), webserver.HTTP_GET)
    self.routes_added = true
  end

  def page_tf()
    if !webserver.check_privileged_access()   return nil   end
    var cfg = {
      'version': self.VERSION,
      'port': self.PORT,
      'token': self.token,
      'cdn': size(self.CDN) > 0 ? f"{self.CDN}v{self.VERSION}/app.js" : '',
      'sri': self.SRI
    }
    webserver.content_open(200, "text/html")
    webserver.content_send(
      '<!doctype html><html><head><meta charset="utf-8">'
      '<meta name="viewport" content="width=device-width,initial-scale=1">'
      '<title>TasmoFlow</title></head><body>'
      '<div id="tasmoflow" style="font-family:system-ui,sans-serif;padding:2rem">TasmoFlow…</div>'
      '<script>window.TASMOFLOW=')
    webserver.content_send(json.dump(cfg))
    webserver.content_send(
      ';(function(c){'
        'c.api="http://"+location.hostname+":"+c.port;'
        'var box=document.getElementById("tasmoflow"),t,fell=false;'
        'function add(src,sri,onerr){'
          'var s=document.createElement("script");s.src=src;'
          'if(sri){s.integrity=sri;s.crossOrigin="anonymous";}'
          's.onload=function(){clearTimeout(t);};s.onerror=onerr;'
          'document.head.appendChild(s);}'
        'function local(){if(fell)return;fell=true;clearTimeout(t);'
          'add(c.api+"/app.js","",function(){'
            'box.textContent="TasmoFlow : interface introuvable (port "+c.port+")";});}'
        'if(c.cdn){add(c.cdn,c.sri,local);t=setTimeout(local,3000);}'
        'else{local();}'
      '})(window.TASMOFLOW);'
      '</script></body></html>')
    webserver.content_close()
  end

  #--------------------------------------------------------------------------------
  # Port 8384 : API
  #--------------------------------------------------------------------------------
  def init_network()
    if self.web != nil    return    end
    try
      self.web = tf_http(self.PORT)
    except .. as e, m
      log(f"TFL: port {self.PORT} indisponible ({e} {m})", 1)
      return
    end
    self.web.set_chunked(false)
    self.web.set_cors(true)
    self.web.on("/app.js", self, self.send_app)
    self.web.on("/api/status", self, self.api_status)
    self.web.on("/api/devices", self, self.api_devices)
    self.web.on("/api/cmd", self, self.api_cmd)
    self.web.on("/api/events", self, self.api_events)
    log(f"TFL: TasmoFlow {self.VERSION}, API sur le port {self.PORT}", 2)
  end

  # copie locale de l'interface, stockee compressee dans la .tapp
  def send_app(cnx, uri, verb)
    var f
    try
      f = open(self.wd + "app.js.gz", "rb")
    except ..
      cnx.send(404, "text/plain", "app.js.gz absent")
      cnx.content_stop()
      return
    end
    cnx.send_header("Content-Encoding", "gzip")
    cnx.send_header("Cache-Control", "max-age=86400")
    cnx.send(200, "application/javascript")
    tf_streamer(cnx, f)
  end

  def api_status(cnx, uri, verb)
    if self.authorized(cnx, uri) == nil   return   end
    var zb = self.zb()
    var zb_started = false
    if zb != nil
      try zb_started = bool(zb.started()) except .. end
    end
    var st = {
      'tasmoflow': self.VERSION,
      'device_name': self.cmdv('DeviceName', 'DeviceName'),
      'firmware': self.cmdv('Status 2', 'StatusFWR'),
      'memory': tasmota.memory(),
      'ufs_size_kb': self.cmdv('UfsSize', 'UfsSize'),
      'ufs_free_kb': self.cmdv('UfsFree', 'UfsFree'),
      'uptime_s': tasmota.millis() / 1000,
      'zigbee': zb_started,
      'zigbee_devices': zb_started ? zb.size() : 0,
      'events_seq': self.seq,
      'feeds': size(self.feeds),
      'wd': self.wd
    }
    self.send_json(cnx, 200, json.dump(st))
  end

  def api_devices(cnx, uri, verb)
    if self.authorized(cnx, uri) == nil   return   end
    cnx.send(200, "application/json", "[")
    var zb = self.zb()
    var started = false
    if zb != nil
      try started = bool(zb.started()) except .. end
    end
    if started
      var sep = ""
      for d: zb
        cnx.write(sep + format('{"addr":"0x%04X","name":%s,"model":%s,"manufacturer":%s,'
                               '"lqi":%s,"battery":%s,"lastseen":%s,"reachable":%s,"router":%s,"info":%s}',
                               d.shortaddr, json.dump(d.name), json.dump(d.model), json.dump(d.manufacturer),
                               json.dump(d.lqi), json.dump(d.battery), json.dump(d.lastseen),
                               json.dump(d.reachable), json.dump(d.router), str(d.info())))
        sep = ","
      end
    end
    cnx.write("]")
    cnx.content_stop()
  end

  # commande Tasmota quelconque : /api/cmd?t=...&c=ZbSend%20...
  def api_cmd(cnx, uri, verb)
    var q = self.authorized(cnx, uri)
    if q == nil   return   end
    var c = q.find('c', '')
    if size(c) == 0
      self.send_json(cnx, 400, '{"error":"cmd"}')
      return
    end
    var r = tasmota.cmd(c, true)
    self.send_json(cnx, 200, r == nil ? '{}' : json.dump(r))
  end

  # flux SSE : /api/events?t=...&since=<dernier seq recu>
  def api_events(cnx, uri, verb)
    var q = self.authorized(cnx, uri)
    if q == nil   return   end
    var since = int(q.find('since', '0'))
    cnx.send(200, "text/event-stream", "retry: 3000\n\n")
    for e: self.events
      if e[0] > since   cnx.write(e[1])   end
    end
    self.feeds.push(cnx)
    while size(self.feeds) > self.MAX_FEEDS
      self.feeds[0].close()
      self.feeds.remove(0)
    end
  end

  def push_event(kind, payload)
    self.seq += 1
    var s = format('id: %i\ndata: {"seq":%i,"type":"%s","ts":%i,%s}\n\n',
                   self.seq, self.seq, kind, tasmota.rtc()['utc'], payload)
    self.events.push([self.seq, s])
    if size(self.events) > self.MAX_EVENTS    self.events.remove(0)    end
    for f: self.feeds
      if f.connected()    f.write(s)    end
    end
  end

  #--------------------------------------------------------------------------------
  # Evenements
  #--------------------------------------------------------------------------------
  # appele par zigbee.dispatch() pour chaque message decode
  def attributes_final(event_type, frame, attr_list, idx)
    if attr_list == nil   return   end
    var zb = self.zb()
    var d = zb != nil ? zb.find(idx) : nil
    var name = d != nil ? d.name : nil
    self.push_event("zigbee", format('"device":"0x%04X","name":%s,"attrs":%s', idx, json.dump(name), str(attr_list)))
  end

  def every_second()
    var i = 0
    while i < size(self.feeds)
      if !self.feeds[i].connected()
        self.feeds.remove(i)
      else
        i += 1
      end
    end
    self.ping += 1
    if self.ping >= 15                  # commentaire SSE : garde les connexions ouvertes
      self.ping = 0
      for f: self.feeds   f.write(": ping\n\n")   end
    end
  end
end

return tasmoflow()
