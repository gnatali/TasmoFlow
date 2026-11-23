# Test of the automations' Berry engine, on standard Berry (no gateway needed)
# Usage: node tests/auto_sample.js > auto.be && berry -s tests/tf_auto_test.be auto.be [tf_autolib.be]
#   (-s: strict mode, as Tasmota compiles; tf_autolib.be: extension/'s by default, CI also tests the
#   .tapp's minified copy)
#
# Runs the Berry the interface generates for tests/auto_sample.js's automations with
# extension/tf_autolib.be on a fake Tasmota that records the rules, the delays and the commands,
# then fires events and checks what was sent. The fake follows tasmota_class.be: add_rule(pat, f, id)
# first removes the rule with the same pattern and id, a rule calls f(value, trigger, event).
import global
import string

class fake_tasmota
  var rules, timers, sent, now, answers
  def init()
    self.rules = []
    self.timers = []
    self.sent = []
    self.now = 0
    self.answers = {}
  end
  def add_rule(pat, f, id)
    self.remove_rule(pat, id)
    self.rules.push([pat, f, id])
  end
  def remove_rule(pat, id)
    var i = 0
    while i < size(self.rules)
      if self.rules[i][0] == pat && self.rules[i][2] == id    self.rules.remove(i)    else    i += 1    end
    end
  end
  def set_timer(ms, f, id)    self.timers.push([self.now + ms, f, id])    end
  def remove_timer(id)
    var i = 0
    while i < size(self.timers)
      if self.timers[i][2] == id    self.timers.remove(i)    else    i += 1    end
    end
  end
  # what a command answers (ZbStatus3, TuyaStatus), nil for the others; every command is recorded
  def cmd(c, mute)
    self.sent.push(c)
    return self.answers.find(c)
  end
  # the event `pat` with `value`, as Tasmota calls the rules registered on it
  def fire(pat, value)
    for r: self.rules.copy()
      if r[0] == pat    r[1](value, pat, nil)    end
    end
  end
  # time goes by: the delays that are due run
  def advance(ms)
    self.now += ms
    var i = 0
    while i < size(self.timers)
      var t = self.timers[i]
      if t[0] <= self.now    self.timers.remove(i)    t[1]()    else    i += 1    end
    end
  end
end
global.tasmota = fake_tasmota()
var logged = []
global.log = def (msg, lvl) logged.push(msg) end
global.format = string.format                 # f-strings call it

def run_file(path)
  var f = open(path)
  var src = f.read()
  f.close()
  return compile(src)()
end

var args = global._argv
var lib_path = size(args) > 2 ? args[2] : "extension/tf_autolib.be"
var lib_class = run_file(lib_path)
var autos = run_file(args[1])
var a = lib_class()
autos(a)

var failed = 0
def check(name, got, want)
  if got != want
    print("FAIL    " + name + ": got " + str(got) + ", want " + str(want))
    failed += 1
  else
    print("ok      " + name)
  end
end
var t = global.tasmota
def sent_since(k) return t.sent[k ..] end

# registrations: a1 by address and name, a2 a Tuya DP and a Tasmota trigger, a4 a connection; a3 disabled
var pats = []
for r: t.rules    pats.push(r[0])    end
check("rules registered", pats, ["ZbReceived#0x922D#Power", "ZbReceived#Interrupteur Entrée#Power", "Tuya", "Power1#State=1", "TuyaConnected"])
var ids = {}
for r: t.rules    ids[r[2]] = true    end
check("one id per rule", size(ids), size(t.rules))

# a1: the button's single press (Power 2) lights the porch; other values do nothing
var k = size(t.sent)
t.fire("ZbReceived#0x922D#Power", 1)
check("other value ignored", sent_since(k), [])
t.fire("ZbReceived#Interrupteur Entrée#Power", 2)
check("button by name", sent_since(k), ["TuyaSend Récepteur radio,2,true"])
# pressed again 4 minutes later: the delay starts again, off 5 minutes after the last press
t.advance(240000)
t.fire("ZbReceived#0x922D#Power", 2)
t.advance(240000)
check("delay restarted", sent_since(k), ["TuyaSend Récepteur radio,2,true", "TuyaSend Récepteur radio,2,true"])
t.advance(61000)
check("off after the last press", t.sent[size(t.sent) - 1], "TuyaSend Récepteur radio,2,false")

# a2: a Tuya DP of Pergola 1 only, if the lamp is off and DP 22 above 500
t.answers["ZbStatus3 0x3C4D"] = {"ZbStatus3": [{"Device": "0x3C4D", "Power": 0, "Dimmer": 150}]}
t.answers["TuyaStatus Pergola 1"] = {"TuyaStatus": {"Pergola 1": {"Connected": true, "Dps": {"20": true, "22": 800}}}}
k = size(t.sent)
t.fire("Tuya", {"Name": "Pergola 2", "Dps": {"20": true}})
t.fire("Tuya", {"Name": "Pergola 1", "Dps": {"21": "white"}})
check("other device or DP ignored", sent_since(k), [])
t.fire("Tuya", {"Name": "Pergola 1", "Dps": {"20": true}})
var last = t.sent[size(t.sent) - 1]
check("Tuya DP, conditions met", last, 'ZbSend {"device":"0x3C4D","send":{"Power":"On"}}')
t.answers["TuyaStatus Pergola 1"]["TuyaStatus"]["Pergola 1"]["Dps"]["22"] = 300
k = size(t.sent)
t.fire("Power1#State=1", 1)
check("a condition not met: no command", sent_since(k), ["ZbStatus3 0x3C4D", "TuyaStatus Pergola 1"])
t.fire("Tuya", "discovery started")            # not a map: ignored
check("not a map", size(t.sent) - k, 2)

# a4: a Tuya device back, any of two conditions, 2 s later; delays that add up
t.answers["TuyaStatus Pince"] = {"TuyaStatus": {"Pince": {"Dps": {}}}}
k = size(t.sent)
t.fire("TuyaConnected", {"Name": "Pince"})
t.fire("TuyaConnected", {"Name": "Pince"})
t.advance(2000)
var toggles = 0
for c: sent_since(k)    if c == "Power2 toggle"    toggles += 1    end    end
check("unknown DP, the other condition holds, delays add up", toggles, 2)

# comparisons
check("cmp bool and word", a.cmp(true, "=", "on"), true)
check("cmp numbers", a.cmp("10", ">", "9"), true)
check("cmp text", a.cmp("White", "=", "white"), true)
check("cmp text with <", a.cmp("a", "<", "b"), false)
check("cmp nil", a.cmp(nil, "!=", "1"), false)
check("cmp real", a.cmp(21.5, ">=", "21.5"), true)
check("num not a number", a.num("12a"), nil)
check("num negative", a.num("-3"), -3)

# an exception in an automation is logged, the other rules of the event still run
var ran = false
a.on("Boom", def (v) raise "value_error", "boom" end)
t.add_rule("Boom", def (v) ran = true end, "other")
t.fire("Boom", 1)
check("exception logged", size(logged) > 0 && string.find(logged[0], "boom") >= 0, true)
check("next rule still runs", ran, true)
t.remove_rule("Boom", "other")

# stop(): nothing left, delays included
t.fire("ZbReceived#0x922D#Power", 2)
a.stop()
check("rules removed", size(t.rules), 0)
check("delays removed", size(t.timers), 0)

if failed > 0
  raise "test_failed", str(failed) + " check(s) failed"
end
print("all automation checks passed")
