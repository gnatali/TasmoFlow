###################################################################################
# tf_autolib.be - what the generated automations call (TasmoFlow automations, Berry engine)
#
# SPDX-License-Identifier: GPL-3.0-only
###################################################################################
# The interface turns each automation (tf_auto.json, the source of truth) into Berry
# (app/src/auto_gen.js) and the gateway runs it: /tf_auto.be returns a function that takes
# an instance of this class and registers its rules through it. Everything it registers is
# recorded, so that stop() removes it before a new version is loaded.
#
# Tasmota's Berry API (lib/libesp32/berry_tasmota/src/embedded/tasmota_class.be, firmware's
# TASMOTA_REF): add_rule(pattern, f, id) first removes the rule with the same pattern AND id,
# so every registration gets its own id (two automations on the `Tuya` event would otherwise
# replace each other); a rule calls f(value, trigger, event); set_timer(ms, f, id) and
# remove_timer(id) for the delays.
#
# Neither the rules nor the timers are run under try by tasmota_class.be (exec_rules, run_timers):
# an exception would skip the other rules of the same event, the Tuya driver's included. Every
# function given to Tasmota here is wrapped (safe()): the error is logged, the rest goes on.
#
# Values are compared by cmp(): booleans and "true"/"false"/"on"/"off" as 1/0, numbers as
# numbers, anything else as text. State conditions read the device when they are evaluated:
# ZbStatus3 answers as the command's response (xdrv_23_zigbee_A_impl.ino, CmndZbStatus),
# TuyaStatus gives the DPs the Tuya driver keeps.

class tf_autolib
  var rules                         # [[pattern, id]] registered
  var timers                        # ids of the delays set
  var n                             # last id number

  def init()
    self.rules = []
    self.timers = []
    self.n = 0
  end

  # f(v), its exceptions logged instead of raised (see above)
  def safe(f)
    return def (v)
      try
        f(v)
      except .. as e, m
        log(f"TFL: automation error {e} {m}", 1)
      end
    end
  end

  # a rule on any Tasmota trigger (`Power1#State=1`, `ZbReceived#0x1234#Power`)
  def on(pat, f)
    self.n += 1
    var id = "tfauto" + str(self.n)
    var g = self.safe(f)
    tasmota.add_rule(pat, / v -> g(v), id)
    self.rules.push([pat, id])
  end

  # a Zigbee attribute: the key is the address or the friendly name depending on SetOption83,
  # so both are registered (only the one Tasmota writes ever fires)
  def zb(keys, attr, f)
    for k: keys
      self.on("ZbReceived#" + k + "#" + attr, / v -> f(v))
    end
  end

  # a DP of a Tuya device: the driver publishes {"Tuya":{"Name":...,"Dps":{...}}} for any device
  def tuya(dev, dp, f)
    self.on("Tuya", def (v)
      if !isinstance(v, map) || v.find("Name") != dev    return    end
      var d = v.find("Dps")
      if isinstance(d, map) && d.contains(dp)    f(d[dp])    end
    end)
  end

  # a Tuya device connecting (on true) or disconnecting
  def tuyaconn(dev, on, f)
    self.on(on ? "TuyaConnected" : "TuyaDisconnected", def (v)
      if isinstance(v, map) && v.find("Name") == dev    f(true)    end
    end)
  end

  # a command (Backlog included), its answer muted in the log
  def cmd(c)
    tasmota.cmd(c, true)
  end

  # the rest of the actions `ms` milliseconds later; `restart`: a new trigger starts the delay again
  # ("off 5 minutes after the last motion"), else delays add up
  def later(id, ms, f, restart)
    if restart    tasmota.remove_timer(id)    end
    var g = self.safe(/ v -> f())
    tasmota.set_timer(ms, / -> g(nil), id)
    if self.timers.find(id) == nil    self.timers.push(id)    end
  end

  # the value of a Zigbee attribute now (nil: unknown)
  def zbget(addr, attr)
    var r = tasmota.cmd("ZbStatus3 " + addr, true)
    var l = isinstance(r, map) ? r.find("ZbStatus3") : nil
    return isinstance(l, list) && size(l) > 0 && isinstance(l[0], map) ? l[0].find(attr) : nil
  end

  # the value of a Tuya DP now, if the driver keeps it (nil: unknown)
  def tuyaget(dev, dp)
    var r = tasmota.cmd("TuyaStatus " + dev, true)
    var s = isinstance(r, map) ? r.find("TuyaStatus") : nil
    var d = isinstance(s, map) ? s.find(dev) : nil
    var dps = isinstance(d, map) ? d.find("Dps") : nil
    return isinstance(dps, map) ? dps.find(dp) : nil
  end

  # a value as a number when it is one (booleans and on/off words as 1/0), else nil
  def num(v)
    if type(v) == "bool"    return v ? 1 : 0    end
    if type(v) == "int" || type(v) == "real"    return v    end
    if type(v) != "string"    return nil    end
    import string
    var s = string.tolower(v)
    if s == "true" || s == "on"    return 1    end
    if s == "false" || s == "off"    return 0    end
    if size(s) == 0    return nil    end
    var i = 0
    var dot = false
    if s[0] == "-"    i = 1    end
    if i >= size(s)    return nil    end
    while i < size(s)
      var c = s[i]
      if c == "."
        if dot    return nil    end
        dot = true
      elif c < "0" || c > "9"
        return nil
      end
      i += 1
    end
    return dot ? real(s) : int(s)
  end

  # a compared with b: op is = == != <> < <= > >=; numbers when both are, else text
  def cmp(a, op, b)
    if a == nil    return false    end
    var x = self.num(a)
    var y = self.num(b)
    if x == nil || y == nil
      import string
      x = string.tolower(str(a))
      y = string.tolower(str(b))
      if op == "=" || op == "=="    return x == y    end
      if op == "!=" || op == "<>"    return x != y    end
      return false
    end
    if op == "=" || op == "=="    return x == y    end
    if op == "!=" || op == "<>"    return x != y    end
    if op == "<"    return x < y    end
    if op == "<="    return x <= y    end
    if op == ">"    return x > y    end
    if op == ">="    return x >= y    end
    return false
  end

  # removes every rule and delay registered
  def stop()
    for r: self.rules    tasmota.remove_rule(r[0], r[1])    end
    for id: self.timers    tasmota.remove_timer(id)    end
    self.rules = []
    self.timers = []
  end
end

return tf_autolib
