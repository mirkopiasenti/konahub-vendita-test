#!/usr/bin/env python3
"""Upload parallel: itera staging dir e fa cp diretto file-per-file con ThreadPoolExecutor.
Path destinazione = path relativo a staging root.
"""
import subprocess
import sys
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
SUPABASE_BIN = ROOT / '.bin' / 'supabase'


def upload_one(args):
    local_path, dest_path = args
    for attempt in range(2):
        try:
            r = subprocess.run(
                [str(SUPABASE_BIN), 'storage', 'cp', str(local_path), dest_path,
                 '--linked', '--experimental'],
                capture_output=True, text=True, timeout=120, cwd=str(ROOT)
            )
            if r.returncode == 0:
                return (True, str(local_path), dest_path, '')
        except subprocess.TimeoutExpired:
            pass
    return (False, str(local_path), dest_path, r.stderr[:200] if 'r' in dir() else 'timeout')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--staging', required=True, help='Path staging dir (es. staging/pda)')
    p.add_argument('--bucket', required=True, help='Bucket name (es. contratti-vendita)')
    p.add_argument('--workers', type=int, default=16)
    p.add_argument('--skip-existing', action='store_true', help='Skippa file gia presenti nel bucket')
    args = p.parse_args()

    staging = Path(args.staging)
    if not staging.is_absolute():
        staging = ROOT / staging
    if not staging.exists():
        print(f"ERR staging non esiste: {staging}")
        sys.exit(1)

    # Load existing objects (skip-existing)
    existing = set()
    if args.skip_existing:
        try:
            print(f"Loading existing objects for {args.bucket}...", flush=True)
            r = subprocess.run(
                [str(SUPABASE_BIN), 'db', 'query', '--linked',
                 f"SELECT name FROM storage.objects WHERE bucket_id='{args.bucket}';"],
                capture_output=True, text=True, timeout=120, cwd=str(ROOT)
            )
            import json
            out = r.stdout
            s = out.find('{'); e = out.rfind('}')
            if s != -1:
                data = json.loads(out[s:e+1])
                for row in data.get('rows', []):
                    existing.add(row['name'])
            print(f"Existing: {len(existing)}", flush=True)
        except Exception as ex:
            print(f"WARN can't load existing: {ex}", flush=True)

    # Raccogli tutti i file
    tasks = []
    skipped = 0
    for f in staging.rglob('*'):
        if not f.is_file():
            continue
        rel = f.relative_to(staging)
        rel_str = rel.as_posix()
        if rel_str in existing:
            skipped += 1
            continue
        dest = f"ss:///{args.bucket}/{rel_str}"
        tasks.append((str(f), dest))

    total = len(tasks)
    print(f"=== Parallel upload: {total} file, workers={args.workers} (skipped existing: {skipped}) ===", flush=True)

    ok_count = 0
    fail_count = 0
    fail_samples = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(upload_one, t) for t in tasks]
        for i, fut in enumerate(as_completed(futures), 1):
            ok, src, dst, err = fut.result()
            if ok:
                ok_count += 1
            else:
                fail_count += 1
                if len(fail_samples) < 5:
                    fail_samples.append((src, err))
            if i % 50 == 0:
                print(f"  ...{i}/{total} (ok={ok_count}, fail={fail_count})", flush=True)

    print(f"\nDone: {ok_count}/{total} success, {fail_count} failed")
    if fail_samples:
        print(f"Sample failures:")
        for s, e in fail_samples:
            print(f"  {s}\n    err: {e[:200]}")


if __name__ == '__main__':
    main()
