#!/usr/bin/env bash
# Small helpers for driving the emulator from the IWSDK CLI (debug aid).
C="npx @iwsdk/cli"
q() { $C "$@" 2>&1 | grep -E '"ok": false|"message"' | head -3; }
state() { $C browser run scripts/probe/state.mjs 2>&1 | python -I -c "
import sys,json
t=sys.stdin.read(); i=t.index('{'); j=t.index('\n}\n')+2
d=json.loads(t[i:j]); print(json.dumps({k:d[k] for k in ('mode','loadN','busy','stress','factor','notice','probe') if k in d}))"; }
target() { $C xr list-targets 2>&1 | python -I -c "
import sys,json
d=json.load(sys.stdin); t=d['data'].get('result',d['data']); items=t.get('targets',t)
print(json.dumps([x for x in items if x['name']=='$1'][0]['position']))"; }
fresh() { q browser reload --input-json '{}'; sleep 6; q xr enter --input-json '{}'; sleep 1.5; }
click() { # click a named target with the right controller ray, from above and in front
  local P; P=$(target "$1"); q xr set-input-mode --input-json '{"mode":"controller"}'
  q xr set-transform --input-json '{"device":"controller-right","position":{"x":0.1,"y":1.42,"z":-0.05}}'
  q xr look-at --input-json "{\"device\":\"controller-right\",\"target\":$P}"; sleep 0.3
  q xr select --input-json '{"device":"controller-right"}'; }
