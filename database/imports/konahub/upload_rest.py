#!/usr/bin/env python3
"""Fast REST uploader per Supabase Storage.
Usa la Storage REST API direttamente (POST /storage/v1/object/<bucket>/<path>)
con service_role key (via env SUPABASE_SERVICE_ROLE_KEY). Molto piu' veloce della CLI.

Uso:
    export SUPABASE_SERVICE_ROLE_KEY='eyJ...'
    python3 upload_rest.py --staging staging/pda --bucket contratti-vendita --workers 24
    python3 upload_rest.py --staging staging/pda --bucket contratti-vendita --skip-existing
"""
import argparse, os, sys, ssl, json, subprocess, mimetypes
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
PROJECT_URL = 'https://lbgwamhjkjjfwgusafbi.supabase.co'
SUPABASE_BIN = ROOT / '.bin' / 'supabase'
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()

_ctx = ssl.create_default_context()


def guess_ct(path):
    ct, _ = mimetypes.guess_type(str(path))
    return ct or 'application/pdf'


def upload_one(args):
    local_path, bucket, obj_path = args
    url = f"{PROJECT_URL}/storage/v1/object/{bucket}/{urllib.parse.quote(obj_path)}"
    try:
        with open(local_path, 'rb') as f:
            data = f.read()
    except Exception as e:
        return (False, obj_path, f"read err: {e}")
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Bearer {KEY}')
    req.add_header('apikey', KEY)
    req.add_header('Content-Type', guess_ct(local_path))
    req.add_header('x-upsert', 'true')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60, context=_ctx) as resp:
                if resp.status in (200, 201):
                    return (True, obj_path, '')
                return (False, obj_path, f"status {resp.status}")
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'ignore')[:150]
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                continue
            return (False, obj_path, f"HTTP {e.code}: {body}")
        except Exception as e:
            if attempt < 2:
                continue
            return (False, obj_path, f"{type(e).__name__}: {e}")
    return (False, obj_path, "retries exhausted")


def load_existing(bucket):
    r = subprocess.run([str(SUPABASE_BIN),'db','query','--linked',
        f"SELECT name FROM storage.objects WHERE bucket_id='{bucket}';"],
        capture_output=True, text=True, timeout=120, cwd=str(ROOT))
    out = r.stdout
    s = out.find('{'); e = out.rfind('}')
    data = json.loads(out[s:e+1])
    return {row['name'] for row in data.get('rows', [])}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--staging', required=True)
    p.add_argument('--bucket', required=True)
    p.add_argument('--workers', type=int, default=24)
    p.add_argument('--skip-existing', action='store_true')
    args = p.parse_args()

    if not KEY:
        print("ERR: manca SUPABASE_SERVICE_ROLE_KEY nell'env")
        sys.exit(2)

    staging = Path(args.staging)
    if not staging.is_absolute():
        staging = ROOT / staging
    if not staging.exists():
        print(f"ERR staging non esiste: {staging}"); sys.exit(1)

    existing = set()
    if args.skip_existing:
        print(f"Loading existing objects for {args.bucket}...", flush=True)
        existing = load_existing(args.bucket)
        print(f"Existing: {len(existing)}", flush=True)

    tasks = []
    skipped = 0
    for f in staging.rglob('*'):
        if not f.is_file():
            continue
        rel = f.relative_to(staging).as_posix()
        if rel in existing:
            skipped += 1
            continue
        tasks.append((str(f), args.bucket, rel))

    total = len(tasks)
    print(f"=== REST upload: {total} file, workers={args.workers} (skipped existing: {skipped}) ===", flush=True)

    ok = 0; fail = 0; fails = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(upload_one, t) for t in tasks]
        for i, fut in enumerate(as_completed(futs), 1):
            success, path, err = fut.result()
            if success:
                ok += 1
            else:
                fail += 1
                if len(fails) < 15:
                    fails.append((path, err))
            if i % 200 == 0:
                print(f"  ...{i}/{total} (ok={ok}, fail={fail})", flush=True)

    print(f"\nDone: {ok}/{total} success, {fail} failed", flush=True)
    for pth, e in fails:
        print(f"  FAIL {pth} :: {e}", flush=True)


if __name__ == '__main__':
    main()
