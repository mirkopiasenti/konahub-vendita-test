#!/usr/bin/env python3
"""Rebuild pulito switch / apri_chiudi su bucket (wipe + REST upload da source diretto).
Nessun staging: legge direttamente le cartelle konahub, uploada file-per-file con nome ascii-folded.
Aggiorna cartella_url.
"""
import argparse, json, os, re, subprocess, ssl, unicodedata, mimetypes
import urllib.request, urllib.error, urllib.parse
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
DOCS = ROOT / 'database/imports/konahub/docs_extract/DOCUMENTI CRM'
SUPABASE_BIN = ROOT / '.bin' / 'supabase'
PROJECT_URL = 'https://lbgwamhjkjjfwgusafbi.supabase.co'
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY','').strip()
_ctx = ssl.create_default_context()


def db_query(sql, timeout=120):
    r = subprocess.run([str(SUPABASE_BIN),'db','query','--linked',sql],
        capture_output=True, text=True, timeout=timeout, cwd=str(ROOT))
    if r.returncode != 0:
        raise RuntimeError(f"DB err: {r.stderr[:300]}")
    out = r.stdout; s = out.find('{'); e = out.rfind('}')
    return json.loads(out[s:e+1])


def ascii_fold(s):
    if not s: return s
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return s.encode('ascii','ignore').decode('ascii')


def normalize_name_key(s):
    if not s: return ''
    return re.sub(r'[^A-Z0-9]', '', ascii_fold(s).upper())


def parse_folder(name):
    m = re.match(r'^(.+?)_(\d{1,2})[.](\d{1,2})[.](\d{2,4})$', name)
    if not m: return None, None
    nm = m.group(1).replace('_','')
    y = m.group(4)
    if len(y)==2: y='20'+y
    return normalize_name_key(nm), f"{y}-{int(m.group(3)):02d}-{int(m.group(2)):02d}"


def safe_name(orig):
    return re.sub(r'[^a-zA-Z0-9._-]', '_', ascii_fold(orig))


def rest_upload(local_path, bucket, obj_path):
    url = f"{PROJECT_URL}/storage/v1/object/{bucket}/{urllib.parse.quote(obj_path)}"
    with open(local_path,'rb') as f: data=f.read()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Bearer {KEY}'); req.add_header('apikey', KEY)
    ct,_ = mimetypes.guess_type(str(local_path))
    req.add_header('Content-Type', ct or 'application/pdf'); req.add_header('x-upsert','true')
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60, context=_ctx) as r:
                if r.status in (200,201): return (True, obj_path, '')
                return (False, obj_path, f"status {r.status}")
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504) and a<2: continue
            return (False, obj_path, f"HTTP {e.code}: {e.read().decode('utf-8','ignore')[:100]}")
        except Exception as e:
            if a<2: continue
            return (False, obj_path, str(e))
    return (False, obj_path, "exhausted")


CONF = {
    'switch': dict(subdir='SWITCH', bucket='switch-sim-files', table='vendita_switch_sim',
                   date_col='data_inserimento', match_cols=['ragione_sociale_attuale','ragione_sociale_rientro'],
                   prefix='pratica', update_col='cartella_url'),
    'apri_chiudi': dict(subdir='APRI-CHIUDI', bucket='apri-chiudi-files', table='vendita_apri_chiudi',
                   date_col='data_inserimento', match_cols=['ragione_sociale_vecchio','ragione_sociale_nuovo'],
                   prefix='pratica', update_col='cartella_url'),
}


def wipe_bucket(bucket, workers):
    r = db_query(f"SELECT name FROM storage.objects WHERE bucket_id='{bucket}';")
    names = [row['name'] for row in r['rows']]
    def _del(n):
        url = f"{PROJECT_URL}/storage/v1/object/{bucket}/{urllib.parse.quote(n)}"
        req = urllib.request.Request(url, method='DELETE')
        req.add_header('Authorization', f'Bearer {KEY}'); req.add_header('apikey', KEY)
        try:
            with urllib.request.urlopen(req, timeout=30, context=_ctx) as resp:
                return resp.status in (200,204)
        except Exception: return False
    deleted = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for ok in ex.map(_del, names):
            if ok: deleted += 1
    return len(names), deleted


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--module', required=True, choices=list(CONF.keys()))
    p.add_argument('--execute', action='store_true')
    p.add_argument('--workers', type=int, default=24)
    args = p.parse_args()
    if args.execute and not KEY:
        print("ERR: manca SUPABASE_SERVICE_ROLE_KEY"); return
    c = CONF[args.module]
    src = DOCS / c['subdir']

    cols = ', '.join(['id', f"{c['date_col']}::date AS day"] + c['match_cols'])
    rows = db_query(f"SELECT {cols} FROM {c['table']} WHERE {c['date_col']} >= '2026-01-01';")['rows']

    folders = [f for f in src.iterdir() if f.is_dir()]
    matched = []
    unmatched = 0
    for folder in folders:
        nk, di = parse_folder(folder.name)
        if not di: unmatched += 1; continue
        day_rows = [r for r in rows if r['day']==di]
        if not day_rows: unmatched += 1; continue
        best = None
        for r2 in day_rows:
            for mc in c['match_cols']:
                v = r2.get(mc)
                if v and (normalize_name_key(v) in nk or nk in normalize_name_key(v)):
                    best = r2; break
            if best: break
        if not best: best = day_rows[0]
        matched.append((folder, best))

    manifest = []
    id_sub = {}
    for folder, row in matched:
        sub = f"{c['prefix']}_{row['id']}"
        id_sub[row['id']] = sub
        for file in sorted(folder.iterdir()):
            if not file.is_file(): continue
            manifest.append((str(file), c['bucket'], f"{sub}/{safe_name(file.name)}"))

    print(f"=== {args.module}: matched {len(matched)}, unmatched {unmatched}, file {len(manifest)} ===", flush=True)
    if not args.execute:
        for m in manifest[:4]: print(f"  {m[2]}")
        return

    tot, deleted = wipe_bucket(c['bucket'], args.workers)
    print(f"  Wiped {deleted}/{tot}", flush=True)

    ok=0; fail=0; fails=[]
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(rest_upload, *m) for m in manifest]
        for fut in as_completed(futs):
            success, path, err = fut.result()
            if success: ok+=1
            else:
                fail+=1
                if len(fails)<8: fails.append((path,err))
    print(f"  Uploaded {ok}/{len(manifest)}, failed {fail}", flush=True)
    for pth,e in fails: print(f"    FAIL {pth} :: {e}")

    # Update cartella_url
    if id_sub:
        vals = ', '.join([f"({i}, '{s}/')" for i,s in id_sub.items()])
        db_query(f"UPDATE {c['table']} t SET {c['update_col']} = v.u FROM (VALUES {vals}) AS v(id,u) WHERE t.id = v.id;", timeout=60)
        print(f"  Updated {len(id_sub)} {c['update_col']}", flush=True)


if __name__ == '__main__':
    main()
