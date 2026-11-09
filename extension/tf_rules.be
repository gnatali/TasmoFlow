###################################################################################
# tf_rules.be - rule management API of TasmoFlow
#
# SPDX-License-Identifier: GPL-3.0-only
###################################################################################
# Loaded (without cache) when the port 8384 server starts and dropped when it stops, so it
# costs no RAM while no interface is open (see tasmoflow.be, load_module()).
#
# Routes (all need the `t` token):
#   /api/rules                 the three Tasmota rule sets (state, text, free space, previous
#                              copy) and the Berry rules registered with tasmota.add_rule()
#   /api/rule_set?n=1&i=0&x=.. writes rule set n. A rule can be 512 characters or more, and
#                              the port 8384 server only reads a short request line: the text
#                              arrives in chunks (i = 0, 1, 2...), `last=1` on the final one
#                              applies it
#   /api/rule_restore?n=1      puts the previous copy back (the current text becomes the new
#                              previous copy, so a restore can be undone)
#
# Every write first copies the current text to /tf_rule<n>.bak, writes with `Rule<n>`, reads
# the rule set back and, if it differs, puts the old text back.
###################################################################################

import json

class tf_rules
  static var MAX_LEN = 2200             # Tasmota stores up to about 2 KB (Unishox compression)

  var tf                                # the tasmoflow instance
  var buf                               # text being received, chunk by chunk
  var n                                 # rule set it is for

  def init(tf)
    self.tf = tf
    self.buf = ''
    self.n = 0
  end

  static def bak_path(n)
    return f"/tf_rule{n}.bak"
  end

  # the Tasmota rule set n as a map (State, Once, StopOnError, Length, Free, Rules), or nil
  def rule(n)
    var r = tasmota.cmd(f"Rule{n}", true)
    return r != nil ? r.find(f"Rule{n}") : nil
  end

  # previous copy of rule set n, or nil
  def read_bak(n)
    var f
    try
      f = open(self.bak_path(n), "r")
    except ..
      return nil
    end
    var s = f.read()
    f.close()
    return s
  end

  def write_bak(n, s)
    var f = open(self.bak_path(n), "w")
    f.write(s)
    f.close()
  end

  # Replaces rule set n by `text`. Returns nil if it worked, else an error code.
  def apply(n, text)
    var r = self.rule(n)
    if r == nil    return "unknown"    end
    var old = r.find('Rules', '')
    if old == text    return nil    end
    try
      self.write_bak(n, old)
    except ..
      return "backup"                   # no room for the copy: nothing was changed
    end
    tasmota.cmd(size(text) > 0 ? f"Rule{n} {text}" : f'Rule{n} ""', true)
    r = self.rule(n)
    if r == nil || r.find('Rules', '') != text
      tasmota.cmd(size(old) > 0 ? f"Rule{n} {old}" : f'Rule{n} ""', true)
      return "write"
    end
    return nil
  end

  def answer(cnx, err)
    var s = err == nil ? '{"ok":true}' : '{"error":' + json.dump(err) + '}'
    cnx.send(err == nil ? 200 : 400, "application/json", s)
    cnx.content_stop()
  end

  def api_rules(cnx, uri, verb)
    if self.tf.authorized(cnx, uri) == nil   return   end
    cnx.send(200, "application/json", '{"rules":[')
    var sep = ""
    for n: 1 .. 3
      var r = self.rule(n)
      if r == nil    continue    end
      var bak = self.read_bak(n)
      cnx.write(sep + format('{"n":%i,"on":%s,"once":%s,"stop":%s,"len":%s,"free":%s,"text":%s,"bak":%s}',
                             n, json.dump(r.find('State') == 'ON'), json.dump(r.find('Once') == 'ON'),
                             json.dump(r.find('StopOnError') == 'ON'), json.dump(r.find('Length')),
                             json.dump(r.find('Free')), json.dump(r.find('Rules', '')),
                             bak == nil ? 'null' : json.dump(bak)))
      sep = ","
    end
    cnx.write('],"berry":[')
    sep = ""
    if tasmota._rules != nil
      for t: tasmota._rules
        if t.id == 'tasmoflow'    continue    end      # TasmoFlow's own rule, never shown
        cnx.write(sep + format('{"rule":%s,"id":%s}', json.dump(str(t.trig.rule)), json.dump(str(t.id))))
        sep = ","
      end
    end
    cnx.write("]}")
    cnx.content_stop()
  end

  def api_rule_set(cnx, uri, verb)
    var q = self.tf.authorized(cnx, uri)
    if q == nil   return   end
    var n = int(q.find('n', '0'))
    var i = int(q.find('i', '0'))
    if n < 1 || n > 3
      self.answer(cnx, "rule")
      return
    end
    if i == 0
      self.buf = ''
      self.n = n
    elif n != self.n || i < 0
      self.buf = ''
      self.answer(cnx, "chunk")
      return
    end
    self.buf += q.find('x', '')
    if size(self.buf) > self.MAX_LEN
      self.buf = ''
      self.answer(cnx, "length")
      return
    end
    if q.find('last') == nil
      self.answer(cnx, nil)
      return
    end
    var text = self.buf
    self.buf = ''
    self.answer(cnx, self.apply(n, text))
  end

  def api_rule_restore(cnx, uri, verb)
    var q = self.tf.authorized(cnx, uri)
    if q == nil   return   end
    var n = int(q.find('n', '0'))
    var bak = n >= 1 && n <= 3 ? self.read_bak(n) : nil
    if bak == nil
      self.answer(cnx, "nobackup")
      return
    end
    self.answer(cnx, self.apply(n, bak))
  end

  def register(web)
    web.on("/api/rules", self, self.api_rules)
    web.on("/api/rule_set", self, self.api_rule_set)
    web.on("/api/rule_restore", self, self.api_rule_restore)
  end
end

return tf_rules
