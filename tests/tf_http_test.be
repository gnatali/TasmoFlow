# Request parser test of extension/tf_http.be, on standard Berry (no gateway needed)
# Usage: berry -s tests/tf_http_test.be     (-s: strict mode, as Tasmota compiles)
#
# Feeds requests to a connection of the real server class through a fake TCP client, in
# one piece and byte by byte, and checks the answer and what the handler received. A long
# request line used to restart the gateway: the `re` module's matcher overflowed the stack
# (docs/architecture.en.md). A PC has a much bigger stack, so this test cannot show that
# crash; it checks the string parser that replaced the regular expressions.
import global
import string

# What the firmware provides and standard Berry lacks
class fake_tasmota
  def add_fast_loop(cb) end
  def remove_fast_loop(cb) end
  def add_driver(d) end
  def remove_driver(d) end
  def loglevel(l) return false end
end
class fake_tcpserver
  def init(port) end
  def hasclient() return false end
  def close() end
end
global.tasmota = fake_tasmota()
global.tcpserver = fake_tcpserver
global.log = def (msg, lvl) end
global.format = string.format                 # f-strings call it

# tcpclientasync: read() hands over one chunk at a time, as TCP segments arrive
class fake_client
  var chunks, out, closed
  def init(chunks)
    self.chunks = chunks
    self.out = ''
    self.closed = false
  end
  def connected() return !self.closed end
  def close() self.closed = true end
  def available() return size(self.chunks) > 0 ? size(self.chunks[0]) : 0 end
  def read()
    var s = self.chunks[0]
    self.chunks.remove(0)
    return s
  end
  def listening() return true end
  def write(b)
    self.out += b.asstring()
    return size(b)
  end
end

var f = open("extension/tf_http.be")
var tf_http = compile(f.read())()
f.close()
var srv = tf_http(8384)
var seen = []                                 # what the handler received
srv.on("/api/", nil, def (cnx, uri, verb)
  seen.push({'verb': verb, 'uri': uri, 'body': cnx.body(), 'host': cnx.header_host,
             'version': cnx.req_version})
  cnx.send(200, "application/json", '{"ok":1}')
  cnx.content_stop()
end)

# runs a request given as a list of chunks; returns [HTTP status or nil, client]
def run(chunks)
  seen.clear()
  var cl = fake_client(chunks)
  var cnx = tf_http.webserver_async_cnx(srv, cl)
  var budget = size(chunks) + 5               # every chunk, then sending and closing
  while budget > 0 && !cl.closed
    cnx.loop()
    budget -= 1
  end
  var code = nil
  if string.find(cl.out, "HTTP/1.1 ") == 0    code = int(cl.out[9 .. 11])    end
  return [code, cl]
end

# one chunk per byte
def bytewise(s)
  var l = []
  for k: 0 .. size(s) - 1    l.push(s[k])    end
  return l
end

def repeat(c, n)
  var s = ''
  while size(s) < n    s += c    end
  return s
end

var TOKEN = "0123456789abcdef0123456789abcdef"
# request line of n characters (CRLF excluded), like the URLs measured on the gateway
def long_line(n)
  var head = "GET /api/status?t=" + TOKEN + "&p="
  var tail = " HTTP/1.1"
  return head + repeat("a", n - size(head) - size(tail)) + tail
end
def get(line) return line + "\r\nHost: gw\r\n\r\n" end

var failures = 0
def check(name, cond, detail)
  if cond
    print("ok      " + name)
  else
    print("FAIL    " + name + " : " + str(detail))
    failures += 1
  end
end

# runs a request and checks its status; for 200, also what the handler received
def expect(name, chunks, code, want)
  try
    var r = run(chunks)
    var got = size(seen) > 0 ? seen[0] : nil
    var ok = r[0] == code && r[1].closed
    if ok && code == 200
      ok = got != nil
      if ok && want != nil
        for k: want.keys()
          if got[k] != want[k]    ok = false    end
        end
      end
    end
    if ok && code != 200    ok = size(seen) == 0    end    # never reaches the handler
    check(name, ok, [r[0], r[1].out[0 .. 60], got])
  except .. as e, m
    check(name, false, f"exception {e} {m}")
  end
end

var STATUS = "/api/status?t=" + TOKEN

# Basics
expect("GET", [get("GET " + STATUS + " HTTP/1.1")], 200,
       {'verb': 'GET', 'uri': STATUS, 'version': '1.1', 'host': 'gw', 'body': ''})
expect("GET, HTTP/1.0", [get("GET " + STATUS + " HTTP/1.0")], 200, {'version': '1.0'})
expect("GET, byte by byte", bytewise(get("GET " + STATUS + " HTTP/1.1")), 200, {'uri': STATUS})
expect("unknown path: 500", [get("GET /other HTTP/1.1")], 500, nil)

# Long request lines (the gateway restarted from about 130 characters)
for n: [112, 152, 192, 300, 512]
  var line = long_line(n)
  check(f"request line of {n} characters is built", size(line) == n, size(line))
  expect(f"request line of {n} characters", [get(line)], 200, {'uri': line[4 .. n - 10]})
end
expect("request line of 192 characters, byte by byte", bytewise(get(long_line(192))), 200,
       {'uri': long_line(192)[4 .. 192 - 10]})
expect("request line of 513 characters: 414", [get(long_line(513))], 414, nil)
expect("request line of 900 characters: 414", [get(long_line(900))], 414, nil)
expect("request line of 900 characters, byte by byte: 414", bytewise(get(long_line(900))), 414, nil)
expect("5000 bytes without CRLF: 414", [repeat("a", 5000)], 414, nil)

# Invalid request lines
expect("no version: 400", ["GET /x\r\n\r\n"], 400, nil)
expect("one word: 400", ["garbage\r\n\r\n"], 400, nil)
expect("empty line first: 400", ["\r\nGET / HTTP/1.1\r\n\r\n"], 400, nil)
expect("no verb: 400", [" / HTTP/1.1\r\n\r\n"], 400, nil)
expect("two spaces: 400", ["GET  / HTTP/1.1\r\n\r\n"], 400, nil)
expect("space in the URI: 400", ["GET /a b HTTP/1.1\r\n\r\n"], 400, nil)
expect("space after the version: 400", ["GET / HTTP/1.1 \r\n\r\n"], 400, nil)
expect("not HTTP: 400", ["GET / HTTX/1.1\r\n\r\n"], 400, nil)
expect("bad version: 400", ["GET / HTTP/1-1\r\n\r\n"], 400, nil)

# Headers
expect("header without space, lower case Content-Length",
       ["POST " + STATUS + " HTTP/1.1\r\ncontent-length:5\r\n\r\nhello"], 200, {'body': 'hello'})
expect("spaces before a value", ["GET " + STATUS + " HTTP/1.1\r\nHost:    gw\r\n\r\n"], 200, {'host': 'gw'})
expect("line without ':' ignored", ["GET " + STATUS + " HTTP/1.1\r\njunk\r\nHost: gw\r\n\r\n"], 200,
       {'host': 'gw'})
expect("empty value", ["GET " + STATUS + " HTTP/1.1\r\nHost:\r\n\r\n"], 200, {'host': ''})
expect("header value of 3000 characters",
       ["GET " + STATUS + " HTTP/1.1\r\nUser-Agent: " + repeat("u", 3000) + "\r\nHost: gw\r\n\r\n"], 200,
       {'host': 'gw'})
expect("header name of 300 characters",
       ["GET " + STATUS + " HTTP/1.1\r\n" + repeat("X", 300) + ": 1\r\nHost: gw\r\n\r\n"], 200, {'host': 'gw'})
var big = "GET " + STATUS + " HTTP/1.1\r\n"
for k: 1 .. 50    big += "X-Filler-" + str(k) + ": " + repeat("f", 90) + "\r\n"    end
expect("headers over 4096 bytes: 431", [big + "\r\n"], 431, nil)
expect("headers over 4096 bytes, byte by byte: 431", bytewise(big + "\r\n"), 431, nil)
expect("headers, byte by byte", bytewise("GET " + STATUS + " HTTP/1.1\r\nHost: gw\r\nAccept: */*\r\n\r\n"),
       200, {'host': 'gw'})

# POST body (Content-Length), the way the interface sends commands and rule texts
var CMD = "POST /api/cmd?t=" + TOKEN + " HTTP/1.1\r\nHost: gw\r\nContent-Type: text/plain\r\nContent-Length: 11\r\n\r\n"
expect("POST, body in the same chunk", [CMD + "Power1 TOGG"], 200, {'verb': 'POST', 'body': 'Power1 TOGG'})
expect("POST, body in a second chunk", [CMD, "Power1 TOGG"], 200, {'body': 'Power1 TOGG'})
expect("POST, byte by byte", bytewise(CMD + "Power1 TOGG"), 200, {'body': 'Power1 TOGG'})
var text = repeat("on Time#Minute do Power1 0 endon ", 2200)[0 .. 2199]
expect("POST, body of 2200 bytes", ["POST /api/rule_set?t=" + TOKEN + " HTTP/1.1\r\nContent-Length: 2200\r\n\r\n",
       text[0 .. 999], text[1000 ..]], 200, {'body': text})
expect("POST, body over 3000 bytes: 413",
       ["POST " + STATUS + " HTTP/1.1\r\nContent-Length: 3001\r\n\r\n" + repeat("b", 3001)], 413, nil)

# Incomplete request: no answer, the connection waits for the rest
var r = run(["GET " + STATUS + " HTTP/1.1\r\nHost: gw\r\n"])
check("incomplete request waits", r[0] == nil && !r[1].closed && size(seen) == 0, [r[0], r[1].closed])

if failures > 0
  raise "test_failed", str(failures) + " failure(s)"
end
print("tf_http_test: all passed")
