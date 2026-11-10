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
#   /api/rule_set?n=1&i=0&x=.. sends the new text of rule set n. A rule can be 512 characters
#                              or more, and the port 8384 server only reads a short request
#                              line: the text arrives in chunks (i = 0, 1, 2...)
#   /api/rule_apply?n=1&step=  applies it: step bak, then put, then check (see step())
#   /api/rule_restore?n=1      puts the previous copy back (the current text becomes the new
#                              previous copy, so a restore can be undone)
#
# Every write first copies the current text to /tf_rule<n>.bak, writes with `Rule<n>`, reads
# the rule set back and, if it differs, the client restores the copy.
###################################################################################

import json
import string

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

  # The Tasmota rule set n as a map (State, Once, StopOnError, Length, Free, Rules), or nil.
  # Never raises. Tasmota answers {"Rule<n>":{...,"Rules":"<text>"}}: if the text holds a line
  # break or a quote that the answer does not escape, the answer is not valid JSON and
  # tasmota.cmd() returns the raw string instead of a map: cut the text out by hand.
  def rule(n)
    try
      var r = tasmota.cmd(f"Rule{n}", true)
      if isinstance(r, map)    return r.find(f"Rule{n}")    end
      if type(r) != 'string'    return nil    end
      var key = ',"Rules":"'
      var i = string.find(r, key)
      if i < 0 || size(r) < i + size(key) + 3    return nil    end
      var head = json.load(r[0 .. i - 1] + '}}')
      if !isinstance(head, map)    return nil    end
      var m = head.find(f"Rule{n}")
      if !isinstance(m, map)    return nil    end
      var a = i + size(key)
      var z = size(r) - 4               # the answer ends with "}}
      m['Rules'] = a <= z ? r[a .. z] : ''
      return m
    except ..
      return nil
    end
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

  # Writing is split in three steps, each one called by its own HTTP request (the text is kept
  # in self.buf between them): a gateway that restarts during a step shows which one it was.
  #   bak    copy the current text to /tf_rule<n>.bak
  #   put    `Rule<n> <text>`
  #   check  read the rule set back: it must equal the text, else "write"
  # Each returns nil if it worked, else an error code. Never raises.
  def step(n, what)
    var text = self.buf
    if what == 'bak'
      var r = self.rule(n)
      if r == nil    return "unknown"    end
      try
        self.write_bak(n, r.find('Rules', ''))
      except ..
        return "backup"                 # no room for the copy: nothing was changed
      end
    elif what == 'put'
      try
        tasmota.cmd(size(text) > 0 ? f"Rule{n} {text}" : f'Rule{n} ""', true)
      except .. as e, m
        return f"exception {e}: {m}"
      end
    elif what == 'check'
      var r = self.rule(n)
      if r == nil || r.find('Rules', '') != text    return "write"    end
      self.buf = ''
    else
      return "step"
    end
    return nil
  end

  # Replaces rule set n by `text` in one go (restore). Returns nil or an error code; if the
  # text did not stay, the previous copy (made by the first step) is put back.
  def apply(n, text)
    self.buf = text
    self.n = n
    for what: ['bak', 'put', 'check']
      var err = self.step(n, what)
      if err != nil
        if what != 'bak'
          try
            self.buf = self.read_bak(n)
            self.step(n, 'put')
          except ..
          end
        end
        self.buf = ''
        return err
      end
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

  # an exception in a handler makes the port 8384 server drop the connection (the browser
  # only sees "Failed to fetch"): answer with its text instead
  def api_rule_set(cnx, uri, verb)
    var q = self.tf.authorized(cnx, uri)
    if q == nil   return   end
    try
      self.rule_set(cnx, q)
    except .. as e, m
      self.buf = ''
      self.answer(cnx, f"exception {e}: {m}")
    end
  end

  def rule_set(cnx, q)
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
    self.answer(cnx, nil)               # the text is applied by /api/rule_apply, step by step
  end

  # /api/rule_apply?n=1&step=bak|put|check
  def api_rule_apply(cnx, uri, verb)
    var q = self.tf.authorized(cnx, uri)
    if q == nil   return   end
    try
      var n = int(q.find('n', '0'))
      if n < 1 || n > 3 || n != self.n
        self.answer(cnx, "chunk")
        return
      end
      self.answer(cnx, self.step(n, q.find('step', '')))
    except .. as e, m
      self.answer(cnx, f"exception {e}: {m}")
    end
  end

  def api_rule_restore(cnx, uri, verb)
    var q = self.tf.authorized(cnx, uri)
    if q == nil   return   end
    try
      var n = int(q.find('n', '0'))
      var bak = n >= 1 && n <= 3 ? self.read_bak(n) : nil
      if bak == nil
        self.answer(cnx, "nobackup")
        return
      end
      self.answer(cnx, self.apply(n, bak))
    except .. as e, m
      self.answer(cnx, f"exception {e}: {m}")
    end
  end

  def register(web)
    web.on("/api/rules", self, self.api_rules)
    web.on("/api/rule_set", self, self.api_rule_set)
    web.on("/api/rule_apply", self, self.api_rule_apply)
    web.on("/api/rule_restore", self, self.api_rule_restore)
  end
end

return tf_rules
