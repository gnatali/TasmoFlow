# tf_http.be - TasmoFlow's asynchronous HTTP server
#
# Copy of lib/libesp32/berry_tasmota/src/embedded/webserver_async.be (Tasmota, GPL-3.0,
# Stephan Hadinger & Theo Arends), commit b7994b52c47777ea3f125723f2ba5db6d3669397.
# The firmware compiles this class but does not expose it to Berry: the official Leds
# Panel extension also ships its own copy. Changes: final test block removed; RAM savings,
# this extension never needs them: chunked encoding (`set_chunked`, always off here:
# responses are closed, not chunked), the integer-to-text helpers `bytes_format_hex` and
# `bytes_append_int`; a POST body is handed over (`body()`); the request line and the
# headers are parsed with `string.find()`, not with the `re` module: its matcher
# (re1.5 `recursiveloop`) calls itself once per character matched by `\S+`, so a long URL
# overflowed the 8 KB stack of Tasmota's loop task and restarted the gateway (see
# docs/architecture.en.md); a request that is too long or invalid gets an error answer
# ({"error":...}) instead of a silent close.
#
# Tested on standard Berry by tests/tf_http_test.be (CI).
#

#
# webserber_async.be - implements a generic async non-blocking HTTP server
#
# Copyright (C) 2023  Stephan Hadinger & Theo Arends
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
#

# restrictions for now:
# 
# Listen to all interfaces
# - GET only
# - no HTTPS
# - support for limited headers
# - HTTP 1.0 only

#@ solidify:webserver_async.webserver_async_cnx,weak
#@ solidify:webserver_async.webserver_async_dispatcher,weak
#@ solidify:webserver_async,weak

class webserver_async
  #############################################################
  # class webserver_async_cnx
  #
  # This instance represents an active connection between
  # the server and a client (TCP connection)
  #############################################################
  static class webserver_async_cnx
    var server                                      # link to server object
    var cnx                                         # holds the tcpclientasync instance
    var close_after_send                            # if true, close after we finished sending the out_buffer
    var fastloop_cb                                 # cb for fastloop
    var buf_in                                      # incoming buffer
    var buf_in_offset
    var buf_out
    var phase                                       # parsing phase: 0/ status line, 1/ headers, 2/ payload, 3/ refused
    # request
    var req_verb                                    # verb for request (GET, or POST with a small body)
    var req_uri                                     # URI for request
    var req_version                                 # HTTP version for request
    var req_len                                     # Content-Length of the request (POST body), 0 if none
    var dispatched                                  # true once the request was handed to its handler
    var header_host                                 # 'Host' header - useful for redirections
    # response
    var resp_headers                                # (string) aggregate headers
    # conversion
    static var CODE_TO_STRING = {
      # 100: "Continue",
      200: "OK",
      # 204: "No Content",
      301: "Moved Permanently",
      400: "Bad Request",
      # 401: "Unauthorized",
      # 403: "Payment Required",      # not sure it's useful in Tasmota context
      404: "Not Found",
      413: "Content Too Large",
      414: "URI Too Long",
      431: "Request Header Fields Too Large",
      500: "Internal Server Error",
      # 501: "Not Implemented"
    }

    #############################################################
    # init
    #
    # Called when a new connection is received from a client
    # Arg:
    #  - server : main instance of `webserver_async` server
    #  - cnx : instance of `tcpclientasync`
    #
    # Responses are never chunked-encoded: the connection is closed at the end
    def init(server, cnx)
      self.server = server
      self.cnx = cnx
      self.buf_in = ''
      self.buf_in_offset = 0
      self.buf_out = bytes()
      self.phase = 0              # 0 = status line
      self.req_len = 0
      self.dispatched = false
      # util
      self.close_after_send = false
      # response
      self.resp_headers = ''
      # register cb
      self.fastloop_cb = def () self.loop() end   # the closure needs to be kept, to allow removal of fast_loop later
      tasmota.add_fast_loop(self.fastloop_cb)
    end

    #############################################################
    # connected: returns `true` if the connection is still open
    #
    def connected()
      return self.cnx ? self.cnx.connected() : false
    end

    #############################################################
    # buf_out_empty: returns `true` if out buffer is empty,
    # i.e. all content was sent to client
    #
    def buf_out_empty()
      return size(self.buf_out) == 0
    end

    #############################################################
    # _write: (internal method) write bytes
    #
    # Arg:
    #   v must be bytes()
    #
    def _write(v)
      var sz_v = size(v)
      if (sz_v == 0)   return end         # do nothing if empty content

      var buf_out = self.buf_out          # keep a copy of reference in local variable (avoids multiple dereferencing)
      var buf_out_sz = size(buf_out)
      buf_out.resize(buf_out_sz + sz_v)
      buf_out.setbytes(buf_out_sz, v)

      self._send()                        # try sending `self.buf_out` now
    end

    #############################################################
    # close: close the connection to client
    #
    # Can be called multiple times
    # Does nothing if connection is already closed
    #
    def close()
      # log(f"WEB: closing cnx", 3)
      if (self.cnx != nil)    self.cnx.close()    end
      self.cnx = nil
    end

    #############################################################
    # loop: called by fastloop every 5 ms
    #
    def loop()
      if self.cnx == nil    # if connection is closed, this instance is marked for deletion
        tasmota.remove_fast_loop(self.fastloop_cb)  # remove from fast_loop
        self.fastloop_cb = nil                      # fastloop_cb can be garbage collected
        return
      end

      self._send()                        # try sending any pending output data

      var cnx = self.cnx                  # keep copy 
      if (cnx == nil)   return    end     # it's possible that it was closed after _send()

      # any new incoming data received?
      if cnx.available() > 0
        var buf_in_new = cnx.read()       # read bytes() object
        if (!self.buf_in)                 # use the same instance if none present
          self.buf_in = buf_in_new
        else                              # or append to current incoming buffer
          self.buf_in += buf_in_new
        end
      end

      # parse incoming data if any
      if (self.buf_in)
        self.parse()
      end
    end

    #############################################################
    # _send: (internal method) try sending pendin data out
    #
    # the content is in `self.buf_out`
    #
    def _send()
      # any data waiting to go out?
      var cnx = self.cnx
      if (cnx == nil)   return  end       # abort if connection is closed

      var buf_out = self.buf_out          # keep reference in local variable
      if size(buf_out) > 0
        if cnx.listening()                # is the client ready to receive?
          var sent = cnx.write(buf_out)   # send the buffer, `sent` contains the number of bytes actually sent
          if sent > 0                     # did we succeed in sending anything?
            # we did sent something
            if sent >= size(buf_out)      # the entire buffer was sent, clear it
              # all sent
              self.buf_out.clear()
            else                          # buffer was sent partially, remove what was sent from `out_buf`
              # remove the first bytes already sent
              self.buf_out.setbytes(0, buf_out, sent)     # copy to index 0 (start of buffer), content from the same buffer starting at offset 'sent'
              self.buf_out.resize(size(buf_out) - sent)   # shrink buffer
            end
          end
        end
      else
        # empty buffer, do the cleaning
        # self.buf_out.clear()              # TODO not needed?
        # self.buf_in_offset = 0            # TODO really useful?

        if self.close_after_send          # close connection if we have sent everything
          self.close()
        end
      end
    end

    #############################################################
    # parse incoming
    #
    # pre: self.buf_in is not empty
    # post: self.buf_in has made progress (smaller or '')
    def parse()
      # log(f"WEB: incoming {bytes().fromstring(self.buf_in).tohex()}", 3)
      if self.phase == 0
        self.parse_http_req_line()
      elif self.phase == 1
        self.parse_http_headers()
      elif self.phase == 2
        self.parse_http_payload()
      else                                # TasmoFlow: request refused, what follows is dropped
        self.buf_in = ''
      end
    end

    #############################################################
    # refuse: answer a request that will not be handled, then close (TasmoFlow)
    #
    # Args:
    #   code: (int) HTTP status, e.g. 414
    #   err: (string) error code sent as {"error":err}, like the API's errors
    #
    def refuse(code, err)
      log(f"TFL: port 8384 request refused ({code} {err})", 2)
      self.phase = 3
      self.buf_in = ''
      self.send(code, "application/json", '{"error":"' + err + '"}')
      self.content_stop()
    end

    #############################################################
    # parse incoming request line
    #
    # TasmoFlow: plain string handling, no regular expression (see the top of this file).
    # Ex: "GET /api/status?t=0123 HTTP/1.1\r\n"
    #
    # pre: self.buf_in is not empty
    # post: self.buf_in has made progress (smaller or '')
    def parse_http_req_line()
      import string
      var buf = self.buf_in
      var lim = self.server.MAX_REQ_LINE
      var eol = string.find(buf, "\r\n")
      if eol < 0                                  # the line is not complete yet
        if size(buf) > lim    self.refuse(414, "uri_too_long")    end
        return
      end
      if eol > lim    self.refuse(414, "uri_too_long")    return    end
      # "<verb> <uri> HTTP/x.y": sp1 ends the verb, sp2 the URI, then exactly 8 characters
      var sp1 = string.find(buf, " ")
      var sp2 = -1
      if sp1 > 0    sp2 = string.find(buf, " ", sp1 + 1)    end
      if sp2 <= sp1 + 1 || sp2 != eol - 9 || buf[sp2 + 1 .. sp2 + 5] != "HTTP/" || buf[sp2 + 7] != "."
        self.refuse(400, "bad_request")
        return
      end
      self.req_verb = buf[0 .. sp1 - 1]           # GET/POST...
      self.req_uri = buf[sp1 + 1 .. sp2 - 1]      # /
      self.req_version = buf[sp2 + 6 .. eol - 1]  # "1.0" or "1.1"
      self.phase = 1                              # proceed to parsing headers
      self.buf_in = buf[eol + 2 ..]               # remove what we parsed
      if tasmota.loglevel(4)
        log(f"WEB: HTTP verb: {self.req_verb} URI: '{self.req_uri}' Version:{self.req_version}", 4)
      end
      self.parse_http_headers()
    end

    #############################################################
    # parse incoming headers
    #
    # TasmoFlow: plain string handling, no regular expression. Each line "<name>:<value>",
    # spaces before the value skipped; a line without ':' is ignored. The headers (all of
    # them, up to the empty line) are refused beyond MAX_HEAD bytes.
    def parse_http_headers()
      import string
      var lim = self.server.MAX_HEAD
      while true
        var buf = self.buf_in
        var off = self.buf_in_offset              # start of the current line
        var eol = string.find(buf, "\r\n", off)
        if eol < 0                                # the line is not complete yet
          if size(buf) > lim    self.refuse(431, "headers_too_long")    end
          return
        end
        if eol == off                             # empty line: end of headers
          self.buf_in = buf[eol + 2 ..]           # keep the payload only
          self.buf_in_offset = 0
          self.phase = 2
          self.parse_http_payload()               # continue to parsing payload
          return
        end
        if eol > lim    self.refuse(431, "headers_too_long")    return    end
        # Ex: "Content-Type: application/json"
        var colon = string.find(buf, ":", off)
        if colon > off && colon < eol
          var v = colon + 1
          while v < eol && buf[v] == " "    v += 1    end
          self.event_http_header(buf[off .. colon - 1], buf[v .. eol - 1])
        end
        self.buf_in_offset = eol + 2
      end
    end

    #############################################################
    # event_http_header: method called for each header received
    #
    # Default implementation only stores "Host" header
    # and ignores all other headers
    #
    # Args:
    #   header_key: string
    #   header_value: string
    #
    def event_http_header(header_key, header_value)
      # log(f"WEB: header key '{header_key}' = '{header_value}'")

      if (header_key == "Host")
        self.header_host = header_value
      elif (header_key == "Content-Length" || header_key == "content-length")
        self.req_len = int(header_value)
      end
    end

    #############################################################
    # event_http_headers_end: called afte all headers are received
    #
    # By default does nothing
    #
    # def event_http_headers_end()
    # end

    #############################################################
    # parse incoming payload (if any)
    #
    # Calls the server's dispatcher with 'verb' and 'uri'
    #
    # Payload is in `self.buf_in`
    #
    def parse_http_payload()
      if self.dispatched    return    end
      # TasmoFlow: a POST body is handed over whole, once all of it has arrived. A long URL
      # made the gateway restart (see docs/architecture.en.md), long data goes in a body.
      if self.req_len > self.server.MAX_BODY
        self.refuse(413, "body_too_long")
        return
      end
      if size(self.buf_in) < self.req_len    return    end     # the rest comes later
      self.dispatched = true
      self.server.dispatch(self, self.req_uri, self.req_verb)
    end

    # POST body (the first Content-Length bytes of the payload) as a string
    def body()
      if self.req_len <= 0    return ''    end
      var b = self.buf_in[0 .. self.req_len - 1]
      return type(b) == 'string' ? b : b.asstring()     # buf_in is a string or a bytes()
    end


    #############################################################
    # Responses
    #############################################################
    # send_header: add header to the response
    #
    # Args:
    #   name: key of header
    #   value: value of header
    #   first: if 'true' prepend, or append if 'false'
    def send_header(name, value, first)
      if first
        self.resp_headers = f"{name}: {value}\r\n{self.resp_headers}"
      else
        self.resp_headers = f"{self.resp_headers}{name}: {value}\r\n"
      end
    end

    #############################################################
    # send: send response to client
    #
    # Args
    #   code: (int) http code (ex: 200)
    #   content_type: (string, opt) MIME type, "text/html" if not specified
    #   content: (bytes or string, opt) first content to send to client (you can send more later)
    #
    def send(code, content_type, content)
      var response = f"HTTP/1.1 {code} {self.CODE_TO_STRING.find(code, 'UNKNOWN')}\r\n"
      self.send_header("Content-Type", content_type ? content_type : "text/html", true)

      self.send_header("Accept-Ranges", "none")
      # cors?
      if self.server.cors
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
      end
      # others
      self.send_header("Connection", "close")

      response += self.resp_headers
      response += "\r\n"
      self.resp_headers = nil

      # send status-line and headers
      self.write_raw(response)

      # send first part of content
      if (content)    self.write(content)   end
    end

    #############################################################
    # write: writes a bytes or string piece of content
    #
    # If content is empty, nothing is sent
    #
    def write(v)
      if type(v) == 'string'          # if string, convert to bytes
        v = bytes().fromstring(v)
      end

      self._write(v)
    end

    #############################################################
    # write_raw: low-level write of string or bytes
    #
    # If content is empty, nothing is sent
    #
    def write_raw(v)
      if (size(v) == 0)   return end

      if type(v) == 'string'          # if string, convert to bytes
        v = bytes().fromstring(v)
      end

      self._write(v)
    end

    #############################################################
    # content_stop: signal that the response is finished
    #
    def content_stop()
      self.close_after_send = true    # close connection when everything was sent to client
    end
  end

  #######################################################################
  # class webserver_async_dispatcher
  #
  # Pre-register callbacks triggered when a certain URL is accessed
  #
  # You can register either a pure function or a method and an instance
  #
  # Pure function:
  #   webserver_async_dispatcher(uri_prefix, nil, func, verb)
  #  will call:
  #   func(cnx, uri, verb)
  #
  # Instance and method:
  #   webserver_async_dispatcher(uri_prefix, instance, method, verb)
  #  will call:
  #   insatnce.method(cnx, uri, verb)
  #
  # Args in:
  #   uri_prefix: prefix string for matchin URI, must start with '/'
  #   cb_obj: 'nil' for pure function or instance from which we call a method
  #   cb_mth: pure function or method to call
  #   verb: verb to match, only supported: 'GET' or 'nil' for any
  #
  # Args of callback:
  #   cnx: instance of 'webserver_async_cnx' for the current connection
  #   uri: full uri of request
  #   verb: verb received (currently only GET is supported)
  #######################################################################
  static class webserver_async_dispatcher
    var uri_prefix                                  # prefix string, must start with '/'
    var verb                                        # verb to match, or nil for ANY
    var cb_obj                                      # callback object (sent as first argument if not 'nil')
    var cb_mth                                      # callback function

    def init(uri_prefix, cb_obj, cb_mth, verb)
      self.uri_prefix = uri_prefix
      self.cb_obj = cb_obj
      self.cb_mth = cb_mth
      self.verb = verb
    end

    # return true if matched
    def dispatch(cnx, uri, verb)
      import string
      if string.find(uri, self.uri_prefix) == 0
        var match = false
        if (self.verb == nil) || (self.verb == verb)
          # method is valid
          var cb_obj = self.cb_obj
          if (cb_obj != nil)
            self.cb_mth(self.cb_obj, cnx, uri, verb)
          else
            self.cb_mth(cnx, uri, verb)
          end
          return true
        end
      end
      return false
    end
  end

  #############################################################
  # class webserver_async
  #
  # This is the main class to call
  #############################################################
  var local_port                                  # listening port, 80 is already used by Tasmota
  var server                                      # instance of `tcpserver`
  var fastloop_cb                                 # closure used by fastloop
  # var timeout                                     # default timeout for tcp connection
  var connections                                 # list of active connections
  # var auth                                        # web authentication string (Basic Auth) or `nil`, in format `user:password` as bade64
  # var cmd                                         # GET url command
  var dispatchers
  var cors                                        # if true send CORS headers (default false)

  # static var TIMEOUT = 1000                       # default timeout: 1000ms

  #############################################################
  # limits (TasmoFlow); the request is parsed without regular expressions
  static var MAX_REQ_LINE = 512                   # longest request line, CRLF excluded (414 beyond)
  static var MAX_HEAD = 4096                      # longest header block (431 beyond)
  static var MAX_BODY = 3000                      # largest POST body accepted (a rule set: 2200)

  #############################################################
  # init
  def init(port, timeout)
    # if (timeout == nil)   timeout = self.TIMEOUT    end
    # if (timeout == nil)   timeout = 1000    end
    self.connections = []
    self.dispatchers = []
    self.server = tcpserver(port)                 # throws an exception if port is not available
    self.cors = false
    # TODO what about max_clients ?
    # register cb
    tasmota.add_driver(self)
    self.fastloop_cb = def () self.loop() end
    tasmota.add_fast_loop(self.fastloop_cb)
  end

  #############################################################
  # enable or disable CORS mode (enabled by default)
  def set_cors(cors)
    self.cors = bool(cors)
  end

  #############################################################
  # closing web server
  def close()
    tasmota.remove_driver(self)
    tasmota.remove_fast_loop(self.fastloop_cb)
    self.fastloop_cb = nil
    self.server.close()

    # close all active connections
    for cnx: self.connections
      cnx.close()
    end
    self.connections = nil      # and free memory
  end

  #############################################################
  # clean connections
  #
  # Remove any connections that is closed or in error
  def clean_connections()
    var idx = 0
    while idx < size(self.connections)
      var cnx = self.connections[idx]
      # remove if not connected
      if !cnx.connected()
        # log("WEB: does not appear to be connected")
        cnx.close()
        self.connections.remove(idx)
      else
        idx += 1
      end
    end
  end

  #############################################################
  # called by fastloop
  def loop()
    self.clean_connections()
    # check if any incoming connection
    while self.server.hasclient()
      # retrieve new client
      self.connections.push(self.webserver_async_cnx(self, self.server.acceptasync()))
    end
  end

  #############################################################
  # add to dispatcher
  def on(prefix, obj, mth, verb)
    var dispatcher = self.webserver_async_dispatcher(prefix, obj, mth, verb)
    self.dispatchers.push(dispatcher)
  end

  #############################################################
  # add to dispatcher
  def dispatch(cnx, uri, verb)
    var idx = 0
    while idx < size(self.dispatchers)
      if (self.dispatchers[idx].dispatch(cnx, uri, verb))
        return
      end
      idx += 1
    end
    # fallback unsupported request  
    cnx.send(500, "text/plain")
    cnx.write("Unsupported")
    cnx.content_stop()
  end

end

return webserver_async
