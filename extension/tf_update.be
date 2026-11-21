###################################################################################
# tf_update.be - update of TasmoFlow.tapp, and the local copy of the interface
#
# SPDX-License-Identifier: GPL-3.0-only
###################################################################################
# Loaded (without cache) at the first /api/update* request, not when the API server starts:
# RAM is tight (see tasmoflow.be, api_update()). Dropped with the server.
#
# The browser downloads the new .tapp from GitHub Pages (a verified HTTPS connection) and sends
# it here in small pieces: the gateway needs no TLS (Tasmota's reserves 16 KB in one piece and
# does not check the server). Routes (all need the `t` token):
#   /api/update_check?size=<total>   room on the file system for a new .tapp of <total> bytes (the
#                              size in latest.json), asked before the download (see room())
#   POST /api/update?off=<offset>&size=<total>   one piece, base64, in the request body. The
#                              first (off=0) checks the room again and starts <tapp>.new, the others
#                              must follow
#   /api/update_apply?size=&sha256=   checks size, zip header and SHA-256 of <tapp>.new, then
#                              installs it and restarts (see apply())
#   /api/update_abort          deletes <tapp>.new
#
# The same routes with `f=js` write the local copy of the interface instead (app.js.gz of this
# version, from GitHub Pages): <tapp>.js.new, then <tapp>.js. update_apply checks its gzip header
# and that its SHA-256 is the one written into the .tapp at packing (tasmoflow.APP_SHA, not one
# given by the browser), records it (persist `tasmoflow_js`) and does not restart. The /tf page
# then loads it before GitHub. /api/update_drop deletes it. After an update of the .tapp the copy
# is another version's: never loaded, the interface saves the new one (update.js).
#
# Installing (since 21 November 2026, bug analysis T10): <tapp> is copied to <tapp>.bak (through
# <tapp>.bak.new, renamed once complete), then <tapp>.new is renamed onto <tapp> in one step. A
# rename onto an existing file replaces it in one commit (littlefs lfs_rename: "If the destination
# exists, it must match the source in type"; nothing on the way refuses an existing destination:
# be_port.cpp -> ZipReadFS.h -> arduino-esp32 VFSImpl::rename -> esp_littlefs vfs_littlefs_rename),
# so a power cut leaves the old or the new <tapp>, never none. Before, <tapp> was renamed to .bak and
# then .new to <tapp>: a cut between the two left no <tapp>, and TasmoFlow did not load. That way is
# still taken when the copy cannot be made (no room for it) or the single rename fails; if it fails
# too, the copy is put back. Never name a copy *.tapp: Tasmota loads every file ending in .tapp at
# boot, and two TasmoFlow.tapp (in / and in /.extensions/) both run. The new version runs after
# `Restart 1`: replacing the file does not touch the code already running.
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
  static var MARGIN_KB = 20             # free file system left once the new file is written

  var tf                                # the tasmoflow instance
  var written                           # bytes of <tapp>.new received so far

  def init(tf)
    self.tf = tf
    self.written = 0
  end

  # the installed .tapp, or nil
  def target()    return self.tf.tapp()    end

  # [file being written, file it becomes, local copy?] for the request's `f`
  def files(q)
    var base = self.target()
    if q.find('f') == 'js'    return [base + ".js.new", base + ".js", true]    end
    return [base + ".new", base, false]
  end

  # the local copy is not this version's any more (deleted, or being replaced)
  static def forget()
    import persist
    persist.tasmoflow_js = ""
    persist.save()
  end

  def answer(cnx, ok, extra)
    var s = ok ? '{"ok":true' + (extra != nil ? extra : '') + '}' : '{"error":' + json.dump(extra) + '}'
    cnx.send(ok ? 200 : 400, "application/json", s)
    cnx.content_stop()
  end

  # size of a file in bytes, 0 if there is none
  static def fsize(name)
    if !path.exists(name)    return 0    end
    var f = open(name, "r")
    var n = f.size()
    f.close()
    return n
  end

  # Room for a new file of `total` bytes, from the real sizes. While a .tapp is written the
  # installed one stays (it then becomes the .bak by a rename, which takes no room), so the new file
  # needs `total` bytes plus MARGIN_KB of free space. A file left by an interrupted transfer (stale)
  # can be deleted to make that room, and so can the previous <tapp>.bak for a .tapp, or the old
  # local copy for a local copy. Returns a map, sizes in bytes:
  #   free (UfsFree, nil if unknown), tapp, bak, js (the local copy), stale, need, room (true if it fits)
  def room(total, q)
    var base = self.target()
    var n = self.files(q)
    var free = tasmota.cmd("UfsFree", true)
    free = isinstance(free, map) ? free.find("UfsFree") : nil
    var r = {'free': free == nil ? nil : int(free) * 1024, 'tapp': self.fsize(base), 'bak': self.fsize(base + ".bak"),
             'js': self.fsize(base + ".js"), 'stale': self.fsize(n[0]), 'need': total + self.MARGIN_KB * 1024}
    r['room'] = free == nil || r['free'] + r['stale'] + (n[2] ? r['js'] : r['bak']) >= r['need']
    return r
  end

  # /api/update_check?size=: the room, before the browser downloads anything
  def check(cnx, q)
    if self.target() == nil    return self.answer(cnx, false, "path")    end
    var total = int(q.find('size', '0'))
    if total <= 0 || total > self.MAX_SIZE    return self.answer(cnx, false, "size")    end
    var r = self.room(total, q)
    r['ok'] = true
    cnx.send(200, "application/json", json.dump(r))
    cnx.content_stop()
  end

  # one piece of the new file
  def receive(cnx, q)
    var base = self.target()
    if base == nil    return self.answer(cnx, false, "path")    end
    var n = self.files(q)
    var tmp = n[0]
    var off = int(q.find('off', '0'))
    var total = int(q.find('size', '0'))
    if off == 0
      if total <= 0 || total > self.MAX_SIZE    return self.answer(cnx, false, "size")    end
      var r = self.room(total, q)
      if !r['room']    return self.answer(cnx, false, "space")    end
      if r['stale'] > 0    path.remove(tmp)    end
      if n[2]
        # the old local copy goes: it is replaced anyway, and is not loaded until the new one is checked
        self.forget()
        if r['js'] > 0    path.remove(n[1])    end
      elif r['free'] != nil && r['bak'] > 0 && r['free'] + r['stale'] < r['need']
        path.remove(base + ".bak")      # the previous copy only goes if the new file needs its room
      end
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

  # copies src to dst 1 KB at a time (no PSRAM: never the whole file); false if it did not work
  # (no room...), with nothing left of dst
  def copy(src, dst)
    var fi
    var fo
    try
      fi = open(src, "r")
      fo = open(dst, "w")
      var b = fi.readbytes(1024)
      while size(b) > 0
        fo.write(b)
        b = fi.readbytes(1024)
      end
      fi.close()
      fo.close()
      if self.fsize(dst) == self.fsize(src)    return true    end
    except ..
      try    fi.close()    except ..    end
      try    fo.close()    except ..    end
    end
    if path.exists(dst)    path.remove(dst)    end
    return false
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

  # checks, then installs and restarts (.tapp) or records the local copy
  def apply(cnx, q)
    var base = self.target()
    if base == nil    return self.answer(cnx, false, "path")    end
    var n = self.files(q)
    var tmp = n[0]
    var bak = base + ".bak"
    var total = int(q.find('size', '0'))
    if total <= 0 || self.written != total || !path.exists(tmp)    return self.answer(cnx, false, "incomplete")    end
    var f = open(tmp, "r")
    var len = f.size()
    var magic = string.tolower(f.readbytes(4).tohex())          # Tasmota's tohex() is upper case
    f.close()
    if len != total    return self.answer(cnx, false, "size")    end
    # a zip (PK\x03\x04), or gzip (1f 8b, then 08: deflate)
    if magic[0 .. (n[2] ? 5 : 7)] != (n[2] ? "1f8b08" : "504b0304")    return self.answer(cnx, false, "format")    end
    var want = n[2] ? self.tf.APP_SHA : q.find('sha256', '')
    if string.tolower(self.sha256(tmp)) != string.tolower(want)    return self.answer(cnx, false, "hash")    end
    if n[2]
      if !path.rename(tmp, n[1])    return self.answer(cnx, false, "install")    end
      import persist
      persist.tasmoflow_js = want
      persist.save()
      log("TFL: local copy of the interface saved", 2)
      return self.answer(cnx, true)
    end
    # the previous .bak goes first (room for the copy), and a copy left by a cut
    var part = bak + ".new"
    if path.exists(part)    path.remove(part)    end
    if path.exists(bak)    path.remove(bak)    end
    var how = "one rename"
    if !(self.copy(base, part) && path.rename(part, bak) && path.rename(tmp, base))
      # no room for the copy, or a rename refused: the two renames of before
      if path.exists(part)    path.remove(part)    end
      how = "two renames"
      if !path.rename(base, bak)    return self.answer(cnx, false, "install")    end
      if !path.rename(tmp, base)
        path.rename(bak, base)                          # put the working copy back
        return self.answer(cnx, false, "install")
      end
    end
    log(f"TFL: update installed ({how}), restarting", 2)
    self.answer(cnx, true, ',"restart":true')
    tasmota.set_timer(1500, def () tasmota.cmd("Restart 1") end)      # after the answer left
  end

  def abort(cnx, q)
    if self.target() != nil && path.exists(self.files(q)[0])    path.remove(self.files(q)[0])    end
    self.written = 0
    self.answer(cnx, true)
  end

  # deletes the local copy of the interface: GitHub only from then on
  def drop(cnx)
    var base = self.target()
    if base == nil    return self.answer(cnx, false, "path")    end
    self.forget()
    for x: [base + ".js", base + ".js.new"]
      if path.exists(x)    path.remove(x)    end
    end
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
      elif route == "/api/update_check"
        self.check(cnx, q)
      elif route == "/api/update_apply"
        self.apply(cnx, q)
      elif route == "/api/update_abort"
        self.abort(cnx, q)
      elif route == "/api/update_drop"
        self.drop(cnx)
      else
        self.answer(cnx, false, "route")
      end
    except .. as e, m
      self.answer(cnx, false, f"exception {e}: {m}")
    end
  end
end

return tf_update
