#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Simulated gateway, to develop the interface without hardware.

Mimics the extension's two servers:
  - port --web (8080 by default): /tf page, extracted as is from
    extension/tasmoflow.be to test the real loader;
  - port --api (8384 by default): /lite.js (gzip), /api/status, /api/devices,
    /api/cmd, /api/rules, /api/rule_set, /api/rule_apply, /api/rule_restore and /api/events (SSE), with the same CORS headers as tf_http.be.

Three fake Zigbee devices send events every 2 seconds. Four fake Tuya devices answer
TuyaEnable, TuyaStatus, TuyaConfig and TuyaSend like the firmware's driver (formats from
docs/tuya-local.en.md of the firmware repository); --no-tuya simulates a gateway without it.

Without --cdn the page only finds the light interface (/lite.js), like a browser that cannot
reach GitHub Pages. --full also serves the full interface (dist/app.js) from the API port,
with its SRI hash, in place of GitHub Pages.

Usage: npm run build && python3 tools/mock_gateway.py --full
       then open http://localhost:8080/tf
"""

import argparse
import base64
import gzip
import hashlib
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

# Tuya driver: state (TuyaStatus) and configuration without keys (TuyaConfig)
TUYA = {
    "Ventilateur": {"Connected": True, "Ip": "192.168.1.20", "Version": "3.5", "Dps": {"20": False, "60": True, "62": 3}},
    "Lampe bureau": {"Connected": True, "Ip": "192.168.1.40", "Version": "3.3", "Dps": {"20": True, "21": "white", "22": 500, "23": 300}},
    "Pince": {"Connected": True, "Ip": "192.168.1.80", "Version": "3.5", "Dps": {"133": 592, "131": 1234}},
    "Entrée-Porche": {"Connected": False, "Ip": "192.168.1.174", "Version": "3.3", "Dps": {}},
}
TUYA_CONF = {"devices": [
    {"name": "Ventilateur", "id": "00000000000000fan001", "key": "***", "ip": "192.168.1.20", "version": "3.5",
     "matter": [{"ep": "Ventilateur", "type": "fan", "dp": 60, "dp_speed": 62, "speed_min": 1, "speed_max": 6},
                {"ep": "Lumière ventilateur", "type": "light0", "dp": 20}]},
    {"name": "Lampe bureau", "id": "00000000000000lamp01", "key": "***", "ip": "192.168.1.40", "version": "3.3",
     "matter": [{"ep": "Lampe bureau", "type": "light2", "dp": 20, "dp_mode": 21, "dp_bri": 22, "dp_ct": 23}]},
    {"name": "Pince", "id": "00000000000000pinc01", "key": "***", "ip": "192.168.1.80", "version": "3.5",
     "sensors": {"Total puissance": [133, 1, "W"], "Total energie": [131, 100, "kWh"]}},
    {"name": "Entrée-Porche", "id": "00000000000000port01", "key": "***", "ip": "192.168.1.174", "version": "3.3"},
]}

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


def push_tuya(name, dps):
    global seq
    with events_lock:
        seq += 1
        payload = {"seq": seq, "type": "tuya", "ts": int(time.time()), "name": name, "dps": dps}
        events.append((seq, f"id: {seq}\ndata: {json.dumps(payload)}\n\n"))
        del events[:-50]


def tuya_command(c):
    """Response to a Tuya* command (None: not one)."""
    word, _, arg = c.partition(" ")
    arg = arg.strip()
    if word == "TuyaEnable":
        return {"TuyaEnable": {"Enabled": True, "State": "running"}}
    if word == "TuyaConfig":
        return {"TuyaConfig": TUYA_CONF}
    if word == "TuyaStatus":
        return {"TuyaStatus": {n: d for n, d in TUYA.items() if not arg or n.lower() == arg.lower()}}
    if word == "TuyaSend":
        name, _, rest = arg.partition(",")
        dp, _, value = rest.partition(",")
        d = TUYA.get(name)
        if d is None:
            return {"TuyaSend": "Unknown device"}
        if not d["Connected"]:
            return {"TuyaSend": "Device not connected"}
        if value == "toggle":
            if not isinstance(d["Dps"].get(dp), bool):
                return {"TuyaSend": "toggle: DP not boolean"}
            new = not d["Dps"][dp]
        else:
            new = json.loads(value)
        d["Dps"][dp] = new
        push_tuya(name, {dp: new})
        return {"TuyaSend": "Done"}
    return None


# Tasmota rule sets (Rule1..Rule3) and the previous copy kept by tf_rules.be
RULES = {n: {"on": False, "once": False, "stop": False, "text": "", "bak": None} for n in (1, 2, 3)}
RULES[1].update(on=True, text="on Button1#State=3 do Power2 toggle endon")
RULES[2].update(text="on Time#Minute=60 do Power1 0 endon on System#Boot do Backlog Delay 50; Power1 1 endon")
BERRY_RULES = [{"rule": "Tuya", "id": "None"}, {"rule": "Button1#State", "id": "my_script"}]
RULE_BUF = {"n": 0, "text": ""}


def rule_view(n):
    r = RULES[n]
    return {"State": "ON" if r["on"] else "OFF", "Once": "ON" if r["once"] else "OFF",
            "StopOnError": "ON" if r["stop"] else "OFF", "Length": len(r["text"]),
            "Free": 511 - len(r["text"]), "Rules": r["text"]}


def rule_command(c):
    """Response to a Rule<n> command (None: not one)."""
    m = re.fullmatch(r"Rule([1-3])(?: (.*))?", c, re.S)
    if not m:
        return None
    n, arg = int(m.group(1)), m.group(2)
    r = RULES[n]
    if arg is not None:
        arg = arg.strip()
        flags = {"0": ("on", False), "1": ("on", True), "4": ("once", False), "5": ("once", True),
                 "8": ("stop", False), "9": ("stop", True)}
        if arg in flags:
            r[flags[arg][0]] = flags[arg][1]
        elif arg == "2":
            r["on"] = not r["on"]
        elif arg == '""':
            r["text"] = ""
        elif arg.startswith("+"):
            r["text"] += arg[1:]
        else:
            r["text"] = arg
    return {f"Rule{n}": rule_view(n)}


def rule_apply(n, text):
    """What tf_rules.apply() does: copy the current text, write, return an error code or None."""
    r = RULES[n]
    if r["text"] == text:
        return None
    r["bak"] = r["text"]
    r["text"] = text
    return None


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


def loader_html(api_port, cdn, sri, token):
    """Rebuilds the /tf page from the strings of page_tf() in tasmoflow.be."""
    src = (ROOT / "extension" / "tasmoflow.be").read_text()
    body = src[src.index("def page_tf()"):]
    body = body[body.index("check_privileged_access"):]
    body = body[body.index("webserver.content_open"):body.index("webserver.content_close")]
    cfg = {"version": (ROOT / "VERSION").read_text().strip(), "port": api_port, "token": token,
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
        html = loader_html(self.server.api_port, self.server.cdn, self.server.sri, self.server.token).encode()
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
        self.route(None)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0") or 0)
        if n > 3000:                  # tf_http.be's MAX_BODY
            self.close_connection = True
            return
        self.route(self.rfile.read(n).decode())

    def route(self, body):
        if len(self.path) > 120:
            # the real gateway restarts on a request line of more than about 130 characters
            # (9 November 2026): the connection is cut, so no test can pass with a long URL
            self.close_connection = True
            self.connection.close()
            return
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
        if body is not None and u.path == "/api/cmd":
            q["c"] = body             # POST: the command is the body
        if body is not None and u.path == "/api/rule_set":
            q.update(i="0", x=body)   # POST: the new text is the body
        elif u.path == "/api/rule_set":
            self.json(400, {"error": "method"})
            return
        if u.path == "/app.js":       # stands for GitHub Pages with --full
            self.head(200, "application/javascript")
            self.wfile.write((ROOT / "dist" / "app.js").read_bytes())
            return
        if u.path == "/lite.js":      # the light interface; the full one comes from --cdn
            self.head(200, "application/javascript", [("Content-Encoding", "gzip")])
            self.wfile.write(gzip.compress((ROOT / "dist" / "lite.js").read_bytes()))
            return
        if not u.path.startswith("/api/"):
            self.head(500, "text/plain")
            self.wfile.write(b"Unsupported")
            return
        if q.get("t") != self.server.token:
            self.json(403, {"error": "token"})
            return
        if u.path == "/api/status":
            self.json(200, {"tasmoflow": (ROOT / "VERSION").read_text().strip(), "device_name": self.server.name,
                            "firmware": {"Version": "16.0.0.2(zbgw03-matter)"}, "memory": {"heap_free": 62},
                            "ufs_size_kb": 320, "ufs_free_kb": 180, "uptime_s": int(time.monotonic()),
                            "zigbee": True, "zigbee_devices": len(DEVICES), "events_seq": seq, "feeds": 1,
                            "wd": "/.extensions/TasmoFlow.tapp#"})
        elif u.path == "/api/devices":
            self.json(200, list(DEVICES.values()))
        elif u.path == "/api/rules":
            self.json(200, {"rules": [{"n": n, "on": r["on"], "once": r["once"], "stop": r["stop"],
                                       "len": len(r["text"]), "free": 511 - len(r["text"]), "text": r["text"],
                                       "bak": r["bak"]} for n, r in RULES.items()],
                            "berry": BERRY_RULES})
        elif u.path == "/api/rule_apply":
            n = int(q.get("n", "0") or 0)
            err = "chunk" if n != RULE_BUF["n"] else None
            if err is None and q.get("step") == "bak":
                RULES[n]["bak"] = RULES[n]["text"]
            elif err is None and q.get("step") == "put":
                RULES[n]["text"] = RULE_BUF["text"]
            elif err is None and q.get("step") == "check":
                RULE_BUF["text"] = ""
            elif err is None:
                err = "step"
            self.json(400 if err else 200, {"error": err} if err else {"ok": True})
        elif u.path in ("/api/rule_set", "/api/rule_restore"):
            n = int(q.get("n", "0") or 0)
            err = None
            if n not in RULES:
                err = "rule"
            elif u.path == "/api/rule_restore":
                err = "nobackup" if RULES[n]["bak"] is None else rule_apply(n, RULES[n]["bak"])
            else:
                if int(q.get("i", "0") or 0) == 0:
                    RULE_BUF.update(n=n, text="")
                RULE_BUF["text"] += q.get("x", "")
                if len(RULE_BUF["text"]) > 2200:
                    RULE_BUF["text"] = ""
                    err = "length"
            self.json(400 if err else 200, {"error": err} if err else {"ok": True})
        elif u.path == "/api/cmd":
            c = q.get("c", "")
            if not c:
                self.json(400, {"error": "cmd"})
                return
            rr = rule_command(c)
            if rr is not None:
                self.json(200, rr)
                return
            tr = tuya_command(c)
            if tr is not None:
                # Tasmota answers an unknown command with {"Command":"Unknown"}
                self.json(200, {"Command": "Unknown"} if self.server.no_tuya else tr)
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
    p.add_argument("--cdn", default="", help="address of app.js to try before the local copy")
    p.add_argument("--sri", default="")
    p.add_argument("--full", action="store_true", help="serve the full interface from the API port, as --cdn would")
    p.add_argument("--token", default=TOKEN, help="API token (32 hexadecimal characters)")
    p.add_argument("--no-tuya", action="store_true", help="gateway without the Tuya driver")
    p.add_argument("--name", default="ZB-GW03 (simulated)", help="DeviceName reported by /api/status")
    a = p.parse_args()
    if a.full:
        a.cdn = f"http://localhost:{a.api}/app.js"
        a.sri = "sha384-" + base64.b64encode(hashlib.sha384((ROOT / "dist" / "app.js").read_bytes()).digest()).decode()
    web = ThreadingHTTPServer(("127.0.0.1", a.web), Web)
    web.api_port, web.cdn, web.sri, web.token = a.api, a.cdn, a.sri, a.token
    api = ThreadingHTTPServer(("127.0.0.1", a.api), Api)
    api.name, api.token, api.no_tuya = a.name, a.token, a.no_tuya
    api.daemon_threads = True
    threading.Thread(target=simulator, daemon=True).start()
    threading.Thread(target=api.serve_forever, daemon=True).start()
    print(f"Simulated gateway: http://localhost:{a.web}/tf (API on port {a.api})")
    web.serve_forever()


if __name__ == "__main__":
    main()
