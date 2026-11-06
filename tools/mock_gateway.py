#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Fausse passerelle pour developper l'interface sans materiel.

Imite les deux serveurs de l'extension :
  - port --web (8080 par defaut) : page /tf, extraite telle quelle de
    extension/tasmoflow.be pour tester le vrai chargeur ;
  - port --api (8384 par defaut) : /app.js (gzip), /api/status, /api/devices,
    /api/cmd et /api/events (SSE), avec les memes en-tetes CORS que tf_http.be.

Trois appareils Zigbee fictifs emettent des evenements toutes les 2 secondes.

Usage : python3 tools/pack_tapp.py --cdn '' && python3 tools/mock_gateway.py
        puis ouvrir http://localhost:8080/tf
"""

import argparse
import gzip
import json
import pathlib
import random
import re
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKEN = "0123456789abcdef0123456789abcdef"

DEVICES = {
    "0x1A2B": {"addr": "0x1A2B", "name": "Bouton salon", "model": "WXKG01LM", "manufacturer": "LUMI",
               "lqi": 120, "battery": 87, "lastseen": 12, "reachable": True, "router": False,
               "info": {"BatteryPercentage": 87}},
    "0x3C4D": {"addr": "0x3C4D", "name": "Lampe salon", "model": "TRADFRI bulb E27", "manufacturer": "IKEA of Sweden",
               "lqi": 200, "battery": None, "lastseen": 3, "reachable": True, "router": True,
               "info": {"Power": 0, "Dimmer": 180}},
    "0x5E6F": {"addr": "0x5E6F", "name": "Capteur bureau", "model": "WSDCGQ11LM", "manufacturer": "LUMI",
               "lqi": 95, "battery": 64, "lastseen": 40, "reachable": True, "router": False,
               "info": {"Temperature": 21.4, "Humidity": 48.2, "BatteryPercentage": 64}},
}

events = []
events_lock = threading.Lock()
seq = 0


def push_event(addr, attrs):
    global seq
    with events_lock:
        seq += 1
        d = DEVICES[addr]
        payload = {"seq": seq, "type": "zigbee", "ts": int(time.time()), "device": addr, "name": d["name"],
                   "attrs": dict({"Device": addr}, **attrs, LinkQuality=d["lqi"])}
        events.append((seq, f"id: {seq}\ndata: {json.dumps(payload)}\n\n"))
        del events[:-50]


def simulator():
    while True:
        time.sleep(2)
        r = random.random()
        if r < 0.4:
            t = round(21 + random.uniform(-1, 1), 1)
            DEVICES["0x5E6F"]["info"]["Temperature"] = t
            push_event("0x5E6F", {"Temperature": t, "Endpoint": 1})
        elif r < 0.7:
            push_event("0x1A2B", {"Click": random.choice(["single", "double", "long"]), "Endpoint": 1})
        else:
            push_event("0x3C4D", {"Power": DEVICES["0x3C4D"]["info"]["Power"], "Endpoint": 1})


def loader_html(api_port, cdn, sri):
    """Recompose la page /tf a partir des chaines de page_tf() dans tasmoflow.be."""
    src = (ROOT / "extension" / "tasmoflow.be").read_text()
    body = src[src.index("def page_tf()"):]
    body = body[body.index("check_privileged_access"):]
    body = body[body.index("webserver.content_open"):body.index("webserver.content_close")]
    cfg = {"version": (ROOT / "VERSION").read_text().strip(), "port": api_port, "token": TOKEN,
           "cdn": cdn, "sri": sri}
    parts = []
    for call in re.findall(r"webserver\.content_send\((.*?)\)\n", body, re.S):
        call = call.strip()
        if call == "json.dump(cfg)":
            parts.append(json.dumps(cfg))
        else:
            parts.append("".join(re.findall(r"'((?:[^'\\]|\\.)*)'", call)))
    return "".join(parts)


class Web(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.split("?")[0] != "/tf":
            self.send_error(404)
            return
        html = loader_html(self.server.api_port, self.server.cdn, self.server.sri).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(html)


class Api(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def head(self, code, ctype, extra=()):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in extra:
            self.send_header(k, v)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Connection", "close")
        self.end_headers()

    def json(self, code, obj):
        self.head(code, "application/json")
        self.wfile.write(json.dumps(obj).encode())

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
        if u.path == "/app.js":
            self.head(200, "application/javascript", [("Content-Encoding", "gzip")])
            self.wfile.write(gzip.compress((ROOT / "app" / "app.js").read_bytes()))
            return
        if not u.path.startswith("/api/"):
            self.head(500, "text/plain")
            self.wfile.write(b"Unsupported")
            return
        if q.get("t") != TOKEN:
            self.json(403, {"error": "token"})
            return
        if u.path == "/api/status":
            self.json(200, {"tasmoflow": (ROOT / "VERSION").read_text().strip(), "device_name": "ZB-GW03 (simulee)",
                            "firmware": {"Version": "16.0.0.2(zbgw03-matter)"}, "memory": {"heap_free": 62},
                            "ufs_size_kb": 320, "ufs_free_kb": 180, "uptime_s": int(time.monotonic()),
                            "zigbee": True, "zigbee_devices": len(DEVICES), "events_seq": seq, "feeds": 1,
                            "wd": "/.extensions/TasmoFlow.tapp#"})
        elif u.path == "/api/devices":
            self.json(200, list(DEVICES.values()))
        elif u.path == "/api/cmd":
            c = q.get("c", "")
            if not c:
                self.json(400, {"error": "cmd"})
                return
            m = re.match(r'ZbSend \{"device":"(0x[0-9A-F]{4})","send":\{"Power":"Toggle"\}\}', c)
            if m and m.group(1) in DEVICES:
                info = DEVICES[m.group(1)]["info"]
                info["Power"] = 1 - info.get("Power", 0)
                push_event(m.group(1), {"Power": info["Power"], "Endpoint": 1})
                self.json(200, {"ZbSend": "Done"})
            else:
                self.json(200, {"Command": c, "Simulated": True})
        elif u.path == "/api/events":
            since = int(q.get("since", "0") or 0)
            self.head(200, "text/event-stream")
            self.wfile.write(b"retry: 3000\n\n")
            last = since
            try:
                while True:
                    with events_lock:
                        new = [e for e in events if e[0] > last]
                    for n, s in new:
                        self.wfile.write(s.encode())
                        last = n
                    self.wfile.flush()
                    time.sleep(0.2)
            except (BrokenPipeError, ConnectionResetError):
                return
        else:
            self.json(404, {"error": "route"})


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--web", type=int, default=8080)
    p.add_argument("--api", type=int, default=8384)
    p.add_argument("--cdn", default="", help="adresse de app.js a essayer avant la copie locale")
    p.add_argument("--sri", default="")
    a = p.parse_args()
    web = ThreadingHTTPServer(("127.0.0.1", a.web), Web)
    web.api_port, web.cdn, web.sri = a.api, a.cdn, a.sri
    api = ThreadingHTTPServer(("127.0.0.1", a.api), Api)
    api.daemon_threads = True
    threading.Thread(target=simulator, daemon=True).start()
    threading.Thread(target=api.serve_forever, daemon=True).start()
    print(f"Passerelle simulee : http://localhost:{a.web}/tf (API sur le port {a.api})")
    web.serve_forever()


if __name__ == "__main__":
    main()
