###################################################################################
# tf_update.be - update of TasmoFlow.tapp by the interface
#
# SPDX-License-Identifier: GPL-3.0-only
###################################################################################
# Loaded (without cache) at the first /api/update* request, not when the API server starts:
# RAM is tight (see tasmoflow.be, api_update()). Dropped with the server.
#
# The browser downloads the new .tapp from GitHub Pages (a verified HTTPS connection) and sends
# it here in small pieces: the gateway needs no TLS (Tasmota's reserves 16 KB in one piece and
# does not check the server). Routes (all need the `t` token):
#   POST /api/update?off=<offset>&size=<total>   one piece, base64, in the request body. The
#                              first (off=0) starts <tapp>.new, the others must follow
#   /api/update_apply?size=&sha256=   checks size, zip header and SHA-256 of <tapp>.new, then
#                              installs it and restarts (see apply())
#   /api/update_abort          deletes <tapp>.new
#
# Installing: <tapp> becomes <tapp>.bak, <tapp>.new becomes <tapp>, and if that fails the copy is
# put back. Never name a copy *.tapp: Tasmota loads every file ending in .tapp at boot, and two
# TasmoFlow.tapp (in / and in /.extensions/) both run. The new version runs after `Restart 1`:
# replacing the file does not touch the code already running.
#
# Source: tasmota/tasmota_xdrv_driver/xdrv_52_3_berry_webclient.ino, embedded/extension_manager.be
# and be_path_tasmota_lib.c of Tasmota (firmware commit a281cece): path.rename/remove/exists
# exist; the extension manager writes over the live file without a check, which is not done here.
###################################################################################

import json
import string
import path
import crypto

class tf_update
  static var MAX_SIZE = 153600          # largest .tapp accepted (pack_tapp.py's budget is smaller: room to grow)
  static var MARGIN_KB = 20             # free file system left after the copy and the new file

  var tf                                # the tasmoflow instance
  var written                           # bytes of <tapp>.new received so far

  def init(tf)
    self.tf = tf
    self.written = 0
  end

  # the installed .tapp: tasmota.wd saved at load time, without its trailing '#'; or nil
  def target()
    var wd = self.tf.wd
    if wd == nil || size(wd) < 2 || wd[size(wd) - 1] != '#'    return nil    end
    return wd[0 .. size(wd) - 2]
  end

  def answer(cnx, ok, extra)
    var s = ok ? '{"ok":true' + (extra != nil ? extra : '') + '}' : '{"error":' + json.dump(extra) + '}'
    cnx.send(ok ? 200 : 400, "application/json", s)
    cnx.content_stop()
  end

  # one piece of the new file
  def receive(cnx, q)
    var base = self.target()
    if base == nil    return self.answer(cnx, false, "path")    end
    var tmp = base + ".new"
    var off = int(q.find('off', '0'))
    var total = int(q.find('size', '0'))
    if off == 0
      if total <= 0 || total > self.MAX_SIZE    return self.answer(cnx, false, "size")    end
      var free = tasmota.cmd("UfsFree", true)
      free = isinstance(free, map) ? free.find("UfsFree") : nil
      # the old file stays until the new one is checked: room for both
      if free != nil && free < (total * 2) / 1024 + self.MARGIN_KB    return self.answer(cnx, false, "space")    end
      self.written = 0
    elif off != self.written
      return self.answer(cnx, false, "offset")          # a piece was lost or repeated: start again
    end
    var data = bytes().fromb64(cnx.body())
    if size(data) == 0    return self.answer(cnx, false, "empty")    end
    var f = open(tmp, off == 0 ? "w" : "a")
    f.write(data)
    f.close()
    self.written += size(data)
    self.answer(cnx, true, ',"written":' + str(self.written))
  end

  # SHA-256 of a file as hex, read 1 KB at a time (no PSRAM: never the whole file)
  def sha256(name)
    var f = open(name, "r")
    var h = crypto.SHA256()
    var b = f.readbytes(1024)
    while size(b) > 0
      h.update(b)
      b = f.readbytes(1024)
    end
    f.close()
    return h.out().tohex()
  end

  # checks, installs, restarts
  def apply(cnx, q)
    var base = self.target()
    if base == nil    return self.answer(cnx, false, "path")    end
    var tmp = base + ".new"
    var bak = base + ".bak"
    var total = int(q.find('size', '0'))
    if total <= 0 || self.written != total || !path.exists(tmp)    return self.answer(cnx, false, "incomplete")    end
    var f = open(tmp, "r")
    var len = f.size()
    var magic = string.tolower(f.readbytes(4).tohex())          # Tasmota's tohex() is upper case
    f.close()
    if len != total    return self.answer(cnx, false, "size")    end
    if magic != "504b0304"    return self.answer(cnx, false, "format")    end         # a zip: PK\x03\x04
    if string.tolower(self.sha256(tmp)) != string.tolower(q.find('sha256', ''))    return self.answer(cnx, false, "hash")    end
    if path.exists(bak)    path.remove(bak)    end
    if !path.rename(base, bak)    return self.answer(cnx, false, "install")    end
    if !path.rename(tmp, base)
      path.rename(bak, base)                            # put the working copy back
      return self.answer(cnx, false, "install")
    end
    log("TFL: update installed, restarting", 2)
    self.answer(cnx, true, ',"restart":true')
    tasmota.set_timer(1500, def () tasmota.cmd("Restart 1") end)      # after the answer left
  end

  def abort(cnx)
    var base = self.target()
    if base != nil && path.exists(base + ".new")    path.remove(base + ".new")    end
    self.written = 0
    self.answer(cnx, true)
  end

  # called by tasmoflow.api_update() once the token was checked; never raises: an exception in a
  # handler makes the port 8384 server drop the connection (the browser: "Failed to fetch")
  def handle(cnx, uri, verb, q)
    try
      var route = string.split(uri, '?')[0]
      if route == "/api/update"
        if verb != 'POST'    return self.answer(cnx, false, "method")    end
        self.receive(cnx, q)
      elif route == "/api/update_apply"
        self.apply(cnx, q)
      elif route == "/api/update_abort"
        self.abort(cnx)
      else
        self.answer(cnx, false, "route")
      end
    except .. as e, m
      self.answer(cnx, false, f"exception {e}: {m}")
    end
  end
end

return tf_update
