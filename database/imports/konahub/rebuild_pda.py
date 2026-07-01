#!/usr/bin/env python3
"""Rebuild PULITO dei documenti PDA su contratti-vendita.

1. Match cartelle konahub -> pratiche Mirox (stesso algoritmo)
2. Genera manifest deterministico: nomi accent-folded, no spazi, collision numbering underscore
3. (execute) Rigenera staging pulito, uploada via REST, re-sync vendita_documenti + nome_cartella_storage

NB: NON tocca i documenti creati dal wizard live (tipo con path lowercase 'contratto_<cat>').
"""
import argparse, csv, json, os, re, subprocess, sys, uuid, shutil, unicodedata, ssl, mimetypes
import urllib.request, urllib.error, urllib.parse
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
DOCS = ROOT / 'database/imports/konahub/docs_extract/DOCUMENTI CRM/PDA + DOC'
STAGING = ROOT / 'database/imports/konahub/staging/pda_clean'
SUPABASE_BIN = ROOT / '.bin' / 'supabase'
PROJECT_URL = 'https://lbgwamhjkjjfwgusafbi.supabase.co'
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()
_ctx = ssl.create_default_context()


def db_query(sql, timeout=180):
    r = subprocess.run([str(SUPABASE_BIN),'db','query','--linked',sql],
        capture_output=True, text=True, timeout=timeout, cwd=str(ROOT))
    if r.returncode != 0:
        raise RuntimeError(f"DB err: {r.stderr[:300]}\nSQL: {sql[:200]}")
    out = r.stdout
    s = out.find('{'); e = out.rfind('}')
    return json.loads(out[s:e+1])


def ascii_fold(s):
    """Rimuove accenti e caratteri non-ASCII safe per storage key."""
    if not s: return s
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    # Storage key: consenti a-z A-Z 0-9 _ - . / e spazio->_
    s = s.encode('ascii', 'ignore').decode('ascii')
    return s


def normalize_name_key(s):
    if not s: return ''
    s = ascii_fold(s).upper()
    return re.sub(r'[^A-Z0-9]', '', s)


def parse_folder(name):
    m = re.match(r'^(.+?)_(\d{1,2})[.](\d{1,2})[.](\d{2,4})$', name)
    if not m: return None, None
    nm = m.group(1).replace('_', '')
    y = m.group(4)
    if len(y) == 2: y = '20' + y
    return normalize_name_key(nm), f"{y}-{int(m.group(3)):02d}-{int(m.group(2)):02d}"


def remap(orig):
    lower = orig.lower()
    if 'pda' in lower or 'contratto' in lower:
        return 'contratto_pda.pdf', 'contratto'
    if 'identit' in lower or 'documento' in lower or 'd_identi' in lower:
        return 'documento_identita.pdf', 'documento_identita'
    if 'bolletta' in lower:
        return 'copia_bolletta.pdf', 'copia_bolletta'
    if 'sim' in lower or 'mnp' in lower:
        return 'copia_sim_mnp.pdf', 'copia_sim_mnp'
    safe = ascii_fold(orig)
    safe = re.sub(r'[^a-zA-Z0-9._-]', '_', safe)
    return safe, 'altro'


def guess_ct(path):
    ct, _ = mimetypes.guess_type(str(path))
    return ct or 'application/pdf'


def rest_upload(local_path, bucket, obj_path):
    url = f"{PROJECT_URL}/storage/v1/object/{bucket}/{urllib.parse.quote(obj_path)}"
    with open(local_path, 'rb') as f:
        data = f.read()
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Bearer {KEY}')
    req.add_header('apikey', KEY)
    req.add_header('Content-Type', guess_ct(local_path))
    req.add_header('x-upsert', 'true')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60, context=_ctx) as resp:
                if resp.status in (200, 201): return (True, obj_path, '')
                return (False, obj_path, f"status {resp.status}")
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8','ignore')[:120]
            if e.code in (429,500,502,503,504) and attempt < 2: continue
            return (False, obj_path, f"HTTP {e.code}: {body}")
        except Exception as e:
            if attempt < 2: continue
            return (False, obj_path, f"{type(e).__name__}: {e}")
    return (False, obj_path, "retries exhausted")


def build_manifest():
    """Ritorna (manifest, pratiche_folded_update) senza toccare nulla."""
    r = db_query("""
        SELECT vp.id, vp.nome_cartella_storage, vp.data_pratica::date AS day,
               vp.anagrafica_id,
               a.ragione_sociale, a.nome_referente,
               (SELECT id FROM vendita_contratti WHERE pratica_id=vp.id LIMIT 1) AS contratto_id
        FROM vendita_pratiche vp
        JOIN anagrafica a ON a.id = vp.anagrafica_id
        WHERE vp.data_pratica >= '2026-01-01';
    """, timeout=120)
    pratiche = r['rows']
    idx = defaultdict(list)
    for p in pratiche:
        for cand in [p['ragione_sociale'], p['nome_referente']]:
            if cand:
                idx[(normalize_name_key(cand), p['day'])].append(p)

    folders = [f for f in DOCS.iterdir() if f.is_dir()]
    matched = []
    unmatched = 0
    for folder in folders:
        nk, di = parse_folder(folder.name)
        if not di:
            unmatched += 1; continue
        cands = idx.get((nk, di), [])
        if not cands:
            day_m = [p for p in pratiche if p['day'] == di]
            best = None
            for p in day_m:
                for c in [p['ragione_sociale'], p['nome_referente']]:
                    if c and (nk in normalize_name_key(c) or normalize_name_key(c) in nk):
                        best = p; break
                if best: break
            if best: cands = [best]
        if not cands:
            unmatched += 1; continue
        matched.append((folder, cands[0]))

    manifest = []  # (src_file, obj_path, tipo, contratto_id, pratica_id, anagrafica_id)
    pratiche_fold = {}  # pratica_id -> folded_cartella (se differisce)
    for folder, pr in matched:
        d = datetime.strptime(pr['day'], '%Y-%m-%d')
        yyyy_mm = f"{d.year}/{d.month:02d}"
        cartella_folded = ascii_fold(pr['nome_cartella_storage'])
        if cartella_folded != pr['nome_cartella_storage']:
            pratiche_fold[pr['id']] = cartella_folded
        collisions = defaultdict(int)
        for file in sorted(folder.iterdir()):
            if not file.is_file(): continue
            new_name, tipo = remap(file.name)
            collisions[new_name] += 1
            if collisions[new_name] > 1:
                new_name = new_name.replace('.pdf', f"_{collisions[new_name]}.pdf")
            obj_path = f"{yyyy_mm}/{cartella_folded}/{new_name}"
            manifest.append({
                'src': str(file), 'obj_path': obj_path, 'tipo': tipo,
                'contratto_id': pr['contratto_id'], 'pratica_id': pr['id'],
                'anagrafica_id': pr['anagrafica_id'], 'file_name': new_name,
            })
    return manifest, pratiche_fold, len(matched), unmatched


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--execute', action='store_true')
    p.add_argument('--workers', type=int, default=24)
    args = p.parse_args()

    if args.execute and not KEY:
        print("ERR: manca SUPABASE_SERVICE_ROLE_KEY"); sys.exit(2)

    print("=== Build manifest ===", flush=True)
    manifest, pratiche_fold, n_matched, n_unmatched = build_manifest()
    print(f"  Pratiche matchate: {n_matched}, unmatched folders: {n_unmatched}")
    print(f"  File nel manifest: {len(manifest)}")
    print(f"  Pratiche con accent-fold: {len(pratiche_fold)}")
    doc_manifest = [m for m in manifest if m['tipo'] != 'altro']
    print(f"  Doc records da creare (tipo != altro): {len(doc_manifest)}")

    if not args.execute:
        for m in manifest[:5]:
            print(f"    {m['obj_path']} [{m['tipo']}]")
        return

    # 1. WIPE bucket contratti-vendita (tutto tranne wizard-test? no, wipe all konahub PDA area)
    print("\n=== WIPE contratti-vendita/2026 ===", flush=True)
    # Cancella tutti gli oggetti via REST list+delete batch by prefix 2026
    # Usiamo storage.objects per prendere i nomi konahub-import (path 'YYYY/MM/Contratto_...')
    r = db_query("SELECT name FROM storage.objects WHERE bucket_id='contratti-vendita';", timeout=120)
    all_names = [row['name'] for row in r['rows']]
    # Manteniamo i wizard-test (path con 'contratto_' lowercase dopo cartella lowercase) — quelli hanno cartella lowercase 'contratto_'
    to_delete = [n for n in all_names if re.match(r'^\d{4}/\d{2}/Contratto_', n)]
    print(f"  Oggetti totali: {len(all_names)}, da cancellare (konahub Contratto_): {len(to_delete)}")
    # Delete via REST DELETE in parallel
    def _del(name):
        url = f"{PROJECT_URL}/storage/v1/object/contratti-vendita/{urllib.parse.quote(name)}"
        req = urllib.request.Request(url, method='DELETE')
        req.add_header('Authorization', f'Bearer {KEY}'); req.add_header('apikey', KEY)
        try:
            with urllib.request.urlopen(req, timeout=30, context=_ctx) as resp:
                return resp.status in (200,204)
        except Exception:
            return False
    deleted = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for ok in ex.map(_del, to_delete):
            if ok: deleted += 1
    print(f"  Cancellati: {deleted}/{len(to_delete)}", flush=True)

    # 2. Delete konahub vendita_documenti (storage_path matching konahub pattern)
    print("\n=== Delete konahub vendita_documenti ===", flush=True)
    db_query("DELETE FROM vendita_documenti WHERE storage_path ~ '^[0-9]{4}/[0-9]{2}/Contratto_';", timeout=120)
    print("  done", flush=True)

    # 3. Update nome_cartella_storage folded
    if pratiche_fold:
        print(f"\n=== Update {len(pratiche_fold)} nome_cartella_storage (fold) ===", flush=True)
        vals = ', '.join([f"('{pid}'::uuid, '{c.replace(chr(39),chr(39)*2)}')" for pid,c in pratiche_fold.items()])
        db_query(f"UPDATE vendita_pratiche p SET nome_cartella_storage = v.c FROM (VALUES {vals}) AS v(id,c) WHERE p.id = v.id::uuid;", timeout=60)
        print("  done", flush=True)

    # 4. Upload via REST
    print(f"\n=== Upload {len(manifest)} file via REST ===", flush=True)
    ok = 0; fail = 0; fails = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(rest_upload, m['src'], 'contratti-vendita', m['obj_path']) for m in manifest]
        for i, fut in enumerate(as_completed(futs), 1):
            success, path, err = fut.result()
            if success: ok += 1
            else:
                fail += 1
                if len(fails) < 10: fails.append((path, err))
            if i % 500 == 0:
                print(f"  ...{i}/{len(manifest)} (ok={ok}, fail={fail})", flush=True)
    print(f"  Upload done: {ok}/{len(manifest)}, failed: {fail}", flush=True)
    for pth, e in fails:
        print(f"    FAIL {pth} :: {e}")

    # 5. Insert vendita_documenti
    print(f"\n=== Insert {len(doc_manifest)} vendita_documenti ===", flush=True)
    BATCH = 200
    ins = 0
    for i in range(0, len(doc_manifest), BATCH):
        sub = doc_manifest[i:i+BATCH]
        values = []
        for m in sub:
            cid = f"'{m['contratto_id']}'::uuid" if m['contratto_id'] else 'NULL'
            values.append(
                f"('{uuid.uuid4()}'::uuid, {cid}, '{m['pratica_id']}'::uuid, '{m['anagrafica_id']}'::uuid, "
                f"'{m['tipo']}', '{m['file_name'].replace(chr(39),chr(39)*2)}', "
                f"'contratti-vendita', '{m['obj_path'].replace(chr(39),chr(39)*2)}')"
            )
        db_query("INSERT INTO vendita_documenti (id, contratto_id, pratica_id, anagrafica_id, tipo_documento, file_name, storage_bucket, storage_path) VALUES "
                 + ', '.join(values) + " ON CONFLICT DO NOTHING;", timeout=120)
        ins += len(sub)
        print(f"  ...inserted {ins}/{len(doc_manifest)}", flush=True)

    print(f"\n=== DONE ===")
    print(f"  uploaded: {ok}, docs inserted: {ins}")


if __name__ == '__main__':
    main()
