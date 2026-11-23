###################################################################################
# tf_auto.be - automations API of TasmoFlow (Berry engine)
#
# SPDX-License-Identifier: GPL-3.0-only
###################################################################################
# Loaded (without cache) at the first /api/automations* request, dropped with the server: the
# automations themselves run without it (tasmoflow.be, start_auto(), and tf_autolib.be).
#
# Two files on the gateway's file system: /tf_auto.json, the automations (the source of truth,
# written and read by the interface) and /tf_auto.be, the Berry the interface generated from them
# (app/src/auto_gen.js), which the gateway runs. Routes (all need the `t` token):
#   /api/automations                    {"ok":true,"loaded":bool,"error":text or null,"bak":bool,"autos":<tf_auto.json>}
#   POST /api/automations_put?f=json|be&off=&size=   one piece (base64 in the body) of <file>.new; the
#                                first (off=0) starts it, the others must follow (body: 3 KB at most)
#   /api/automations_apply?json=&be=    checks both .new files' sizes and that the Berry compiles, keeps
#                                the current files as .bak, puts the new ones in place and runs them;
#                                if they fail to start, the previous ones are put back and run again
#   /api/automations_restore            the .bak files back in place, and run
# A copy of the previous version before every write (specification F3.14). Files are read 1 KB at
# a time, except the Berry, which compile() needs whole (MAX_SIZE).

import json
import string
import path

class tf_auto
  static var JSON = "/tf_auto.json"
  static var BE = "/tf_auto.be"
  static var MAX_SIZE = 16384           # bytes of each file: the Berry is read whole to be compiled (no PSRAM)

  var tf                                # the tasmoflow instance
  var written                           # {"json": bytes, "be": bytes} of the .new files received

  def init(tf)
    self.tf = tf
    self.written = {"json": 0, "be": 0}
  end

  def answer(cnx, ok, extra)
    var s = ok ? '{"ok":true' + (extra != nil ? extra : '') + '}' : '{"error":' + json.dump(extra) + '}'
    cnx.send(ok ? 200 : 400, "application/json", s)
    cnx.content_stop()
  end

  static def fsize(name)
    if !path.exists(name)    return 0    end
    var f = open(name, "r")
    var n = f.size()
    f.close()
    return n
  end

  # the file of the request's `f`, or nil
  def file(q)
    var w = q.find('f', '')
    return w == 'json' ? self.JSON : w == 'be' ? self.BE : nil
  end

  # /api/automations: the state of the engine and the automations
  def get(cnx)
    var head = format('{"ok":true,"loaded":%s,"error":%s,"bak":%s,"autos":', json.dump(self.tf.auto != nil),
                      json.dump(self.tf.auto_err), json.dump(path.exists(self.JSON + ".bak")))
    cnx.send(200, "application/json", head)
    if path.exists(self.JSON)
      var f = open(self.JSON, "r")
      var b = f.readbytes(1024)
      while size(b) > 0
        cnx.write(b.asstring())
        b = f.readbytes(1024)
      end
      f.close()
    else
      cnx.write("[]")
    end
    cnx.write("}")
    cnx.content_stop()
  end

  # one piece of a new file
  def put(cnx, q)
    var name = self.file(q)
    if name == nil    return self.answer(cnx, false, "file")    end
    var w = q['f']
    var off = int(q.find('off', '0'))
    var total = int(q.find('size', '0'))
    if off == 0
      if total <= 0 || total > self.MAX_SIZE    return self.answer(cnx, false, "size")    end
      self.written[w] = 0
    elif off != self.written[w]
      return self.answer(cnx, false, "offset")          # a piece was lost or repeated: start again
    end
    var data = bytes().fromb64(cnx.body())
    if size(data) == 0    return self.answer(cnx, false, "empty")    end
    var f = open(name + ".new", off == 0 ? "w" : "a")
    f.write(data)
    f.close()
    self.written[w] += size(data)
    self.answer(cnx, true, ',"written":' + str(self.written[w]))
  end

  # nil if the Berry of `name` compiles, else the error
  def compiles(name)
    try
      var f = open(name, "r")
      var src = f.read()
      f.close()
      compile(src)
      return nil
    except .. as e, m
      return f"{e}: {m}"
    end
  end

  # `name` takes the place of `cur`, which becomes cur.bak (an existing .bak is replaced)
  def swap(name, cur)
    if path.exists(cur)
      if path.exists(cur + ".bak")    path.remove(cur + ".bak")    end
      path.rename(cur, cur + ".bak")
    end
    path.rename(name, cur)
  end

  # puts .bak back in place of `cur` (nothing if there is no .bak)
  def back(cur)
    if !path.exists(cur + ".bak")    return false    end
    if path.exists(cur)    path.remove(cur)    end
    path.rename(cur + ".bak", cur)
    return true
  end

  def apply(cnx, q)
    var sj = int(q.find('json', '0'))
    var sb = int(q.find('be', '0'))
    if sj <= 0 || self.fsize(self.JSON + ".new") != sj    return self.answer(cnx, false, "size json")    end
    if sb <= 0 || self.fsize(self.BE + ".new") != sb    return self.answer(cnx, false, "size be")    end
    var err = self.compiles(self.BE + ".new")
    if err != nil
      path.remove(self.BE + ".new")
      return self.answer(cnx, false, "compile " + err)
    end
    self.swap(self.JSON + ".new", self.JSON)
    self.swap(self.BE + ".new", self.BE)
    self.written = {"json": 0, "be": 0}
    err = self.tf.start_auto()
    if err != nil
      # the new version does not start: the previous one comes back, the new one is dropped (a
      # restore must never bring back a version known not to start)
      self.back(self.JSON)
      self.back(self.BE)
      self.tf.start_auto()
      return self.answer(cnx, false, "start " + err)
    end
    self.answer(cnx, true, ',"loaded":true')
  end

  def restore(cnx)
    if !self.back(self.JSON)    return self.answer(cnx, false, "no copy")    end
    self.back(self.BE)
    var err = self.tf.start_auto()
    if err != nil    return self.answer(cnx, false, "start " + err)    end
    self.answer(cnx, true)
  end

  # called by tasmoflow.api_auto() once the token was checked; never raises (an exception in a
  # handler makes the port 8384 server drop the connection)
  def handle(cnx, uri, verb, q)
    try
      var route = string.split(uri, '?')[0]
      if route == "/api/automations"
        self.get(cnx)
      elif route == "/api/automations_put"
        if verb != 'POST'    return self.answer(cnx, false, "method")    end
        self.put(cnx, q)
      elif route == "/api/automations_apply"
        self.apply(cnx, q)
      elif route == "/api/automations_restore"
        self.restore(cnx)
      else
        self.answer(cnx, false, "route")
      end
    except .. as e, m
      self.answer(cnx, false, f"exception {e}: {m}")
    end
  end
end

return tf_auto
