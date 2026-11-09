###################################################################################
# tasmoflow.be - TasmoFlow, no-code web interface for a Tasmota Zigbee gateway
#
# SPDX-License-Identifier: GPL-3.0-only
###################################################################################
# Two servers:
#
# - port 80, Tasmota's web server: "TasmoFlow" button in the main menu and /tf page,
#   protected by the web password, which loads the full interface from GitHub Pages
#   (pinned version, SRI hash) or, failing that, the light interface kept in the .tapp.
#
# - port 8384, Berry asynchronous server (tf_http.be): JSON API, event stream
#   (Server-Sent Events) and light interface. The main server cannot add
#   HTTP headers from Berry (neither CORS nor Content-Encoding): this second port can,
#   without rebuilding the firmware.
#
# RAM is the critical resource (no PSRAM): the port 8384 server only runs while an
# interface is open. The /tf page starts it, and so does /tf?w=1 (without password and
# without any data: it only starts the server, so that another gateway's interface can
# reach this one). It stops after IDLE_MS without a request or an open event stream.
# tf_http.be is only compiled when the server starts (loaded without cache, so it is freed
# when the server stops), and events are only kept while the server runs.
#
# The API routes require the `t` token, created at first start and only handed out
# by the /tf page.
#
# The @@...@@ markers are replaced by tools/pack_tapp.py.
###################################################################################

import webserver
import string
import json

#################################################################################
# Sends a file in 1 KB chunks, at the client's pace: a file of the .tapp must never be
# loaded into RAM in one go.
#################################################################################
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

#################################################################################
class tasmoflow
  static var VERSION = "@@VERSION@@"
  static var CDN = "@@CDN@@"            # GitHub Pages address ('' = local copy only)
  static var DIR = "@@APP_DIR@@"        # folder of app.js there: vX.Y.Z, or "dev" (test build, see below)
  static var SRI = "@@SRI@@"            # SRI hash (sha384) of app.js
  static var PORT = 8384
  static var IDLE_MS = 300000           # API server stopped after 5 minutes without a client
  static var MAX_EVENTS = 50            # events kept for clients that reconnect
  static var MAX_FEEDS = 3              # event streams open at the same time

  var wd                                # .tapp folder, e.g. '/.extensions/TasmoFlow.tapp#'
  var web                               # tf_http server on port 8384
  var rules                             # tf_rules (rule API), loaded with the server
  var token
  var events                            # [ [seq, SSE text], ... ]
  var seq
  var feeds                             # open SSE connections
  var ping
  var idle_at                           # millis() after which an unused API server stops
  var routes_added

  def init()
    self.wd = tasmota.wd
    self.events = []
    self.seq = 0
    self.feeds = []
    self.ping = 0
    self.idle_at = 0
    self.routes_added = false
    self.token = self.load_token()

    tasmota.add_driver(self)
    # extension installed while running: Tasmota will not send web_add_handler again
    if webserver.state() != 0   self.web_add_handler()   end
    log(f"TFL: TasmoFlow {self.VERSION}, API on port {self.PORT} once an interface is opened", 2)
  end

  def unload()
    self.stop_api()
    if self.routes_added    webserver.remove_route("/tf", webserver.HTTP_GET)    end
    tasmota.remove_driver(self)
  end

  #################################################################################
  # Helpers
  #################################################################################
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

  # value returned by a Tasmota command, or nil
  static def cmdv(cmd, key)
    var r = tasmota.cmd(cmd, true)
    return r != nil ? r.find(key) : nil
  end

  def send_json(cnx, code, s)
    cnx.send(code, "application/json", s)
    cnx.content_stop()
  end

  # returns the decoded query, or nil (and answers 403) if the token is missing
  def authorized(cnx, uri)
    self.touch()
    var q = self.parse_query(uri)
    if q.find('t') == self.token    return q    end
    self.send_json(cnx, 403, '{"error":"token"}')
    return nil
  end

  #################################################################################
  # Port 80: button and /tf page
  #################################################################################
  def web_add_main_button()
    webserver.content_send("<p></p><form id=but_tasmoflow style='display: block;' action='tf' method='get'><button>TasmoFlow</button></form>")
  end

  def web_add_handler()
    if self.routes_added    return    end
    webserver.on("/tf", / -> self.page_tf(), webserver.HTTP_GET)
    self.routes_added = true
  end

  def page_tf()
    # /tf?w=1: wakes the API server for another gateway's interface (opaque request, no data)
    if webserver.has_arg("w")
      self.start_api()
      webserver.content_open(200, "text/plain")
      webserver.content_send("ok")
      webserver.content_close()
      return
    end
    # Tasmota refuses a protected page without a Referer header (typed address, bookmark)
    # and then sends nothing back. Without a Referer, answer with a page that reloads
    # itself: the browser then adds the Referer. `r=1` avoids a loop if the browser never
    # sends a Referer (privacy setting): SetOption128 1 is then the only way, as for
    # Tasmota's own pages.
    var referer = webserver.header("Referer")
    if (referer == nil || size(referer) == 0) && !webserver.has_arg("r")
      webserver.content_open(200, "text/html")
      webserver.content_send('<!doctype html><meta charset="utf-8"><title>TasmoFlow</title>'
                             '<script>location.replace("/tf?r=1")</script><a href="/tf?r=1">TasmoFlow</a>')
      webserver.content_close()
      return
    end
    if !webserver.check_privileged_access()   return nil   end
    self.start_api()
    var url = ''
    if size(self.CDN) > 0
      url = self.CDN + self.DIR + "/app.js"
      # test build (dev folder, no SRI, replaced at every run): never served from a cache
      if self.DIR == 'dev'    url += "?t=" + str(tasmota.millis())    end
    end
    var cfg = {
      'version': self.VERSION,
      'port': self.PORT,
      'token': self.token,
      'cdn': url,
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
          'add(c.api+"/lite.js","",function(){'
            'box.textContent="TasmoFlow: interface not found (port "+c.port+")";});}'
        'if(c.cdn){add(c.cdn,c.sri,local);t=setTimeout(local,3000);}'
        'else{local();}'
      '})(window.TASMOFLOW);'
      '</script></body></html>')
    webserver.content_close()
  end

  #################################################################################
  # Port 8384: API, started on demand
  #################################################################################
  def touch()
    self.idle_at = tasmota.millis(self.IDLE_MS)
  end

  # Tasmota only keeps the .tapp folder in sys.path while it loads the extension, then removes
  # it: a later `import tf_http` fails ("module not found") unless the folder is added back.
  # Loads the file `name`.be of the .tapp and returns what it returns (a class), or nil.
  # Never raises: an error here must not stop /tf from answering (Tasmota then sends nothing,
  # and the browser shows ERR_EMPTY_RESPONSE).
  def load_module(name)
    import sys
    var path = sys.path()
    var added = path.find(self.wd) == nil
    if added    path.push(self.wd)    end
    var cls = nil
    try
      # not cached (like autoexec.be does for this extension): a cached module stays in RAM for
      # good, an uncached one is freed by tasmota.gc() once stop_api() dropped every reference
      import introspect
      cls = introspect.module(name, true)
    except .. as e, m
      log(f"TFL: cannot load {name}.be from '{self.wd}' ({e} {m})", 1)
    end
    var i = path.find(self.wd)
    if added && i != nil    path.remove(i)    end
    return cls
  end

  def start_api()
    self.touch()
    if self.web != nil || !tasmota.is_network_up()   return   end
    var tf_http = self.load_module('tf_http')   # compiled here, the first time: no RAM before
    if tf_http == nil    return    end
    try
      self.web = tf_http(self.PORT)
    except .. as e, m
      log(f"TFL: port {self.PORT} unavailable ({e} {m})", 1)
      return
    end
    self.web.set_cors(true)
    self.web.on("/lite.js", self, self.send_lite)
    self.web.on("/api/status", self, self.api_status)
    self.web.on("/api/devices", self, self.api_devices)
    self.web.on("/api/cmd", self, self.api_cmd)
    self.web.on("/api/events", self, self.api_events)
    var tf_rules = self.load_module('tf_rules')
    if tf_rules != nil
      self.rules = tf_rules(self)
      self.rules.register(self.web)
    end
    var zb = self.zb()
    if zb != nil    zb.add_handler(self)    end
    # state changes of the firmware's Tuya driver ({"Tuya":{"Name":...,"Dps":{...}}}); the
    # callback must be a closure, not a method, and the id lets stop_api() remove only ours
    tasmota.add_rule("Tuya", / v -> self.tuya_event(v), 'tasmoflow')
    log(f"TFL: API server started on port {self.PORT}", 2)
  end

  def stop_api()
    if self.web == nil    return    end
    var zb = self.zb()
    if zb != nil    zb.remove_handler(self)    end
    tasmota.remove_rule("Tuya", 'tasmoflow')
    for f: self.feeds   f.close()   end
    self.feeds = []
    self.events = []
    self.web.close()
    self.web = nil
    self.rules = nil
    tasmota.gc()                        # frees the compiled tf_http class
    log("TFL: API server stopped", 2)
  end

  # light interface, stored gzipped in the .tapp (the full one only lives on GitHub Pages)
  def send_lite(cnx, uri, verb)
    self.touch()
    var f
    try
      f = open(self.wd + "lite.js.gz", "rb")
    except ..
      cnx.send(404, "text/plain", "lite.js.gz missing")
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

  # any Tasmota command: /api/cmd?t=...&c=ZbSend%20...
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

  # SSE stream: /api/events?t=...&since=<last seq received>
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

  #################################################################################
  # Events
  #################################################################################
  # called by zigbee.dispatch() for each decoded message
  def attributes_final(event_type, frame, attr_list, idx)
    if attr_list == nil || self.web == nil   return   end
    var zb = self.zb()
    var d = zb != nil ? zb.find(idx) : nil
    var name = d != nil ? d.name : nil
    self.push_event("zigbee", format('"device":"0x%04X","name":%s,"attrs":%s', idx, json.dump(name), str(attr_list)))
  end

  # Tuya driver rule: v is {"Name": device, "Dps": {dp: value}}
  def tuya_event(v)
    if self.web == nil || !isinstance(v, map)   return   end
    var dps = v.find('Dps')
    if !isinstance(dps, map)   return   end
    self.push_event("tuya", format('"name":%s,"dps":%s', json.dump(v.find('Name')), json.dump(dps)))
  end

  def every_second()
    if self.web == nil    return    end
    var i = 0
    while i < size(self.feeds)
      if !self.feeds[i].connected()
        self.feeds.remove(i)
      else
        i += 1
      end
    end
    if size(self.feeds) > 0
      self.touch()                      # an open interface keeps the server alive
    elif tasmota.time_reached(self.idle_at)
      self.stop_api()
      return
    end
    self.ping += 1
    if self.ping >= 15                  # SSE comment: keeps connections open
      self.ping = 0
      for f: self.feeds   f.write(": ping\n\n")   end
    end
  end
end

return tasmoflow()
