#!/usr/bin/env python3
"""Upload storage v2 - bulk strategy.

1) Per ogni cartella konahub: crea symlink nella staging dir con path destinazione corretto
2) UN solo `supabase storage cp -r staging/<bucket>/ ss:///<bucket>/ -j 16` per bucket
3) UN solo UPDATE/INSERT batch SQL per ogni modulo
"""
import argparse, csv, json, os, re, subprocess, sys, uuid, shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
DOCS = ROOT / 'database' / 'imports' / 'konahub' / 'docs_extract' / 'DOCUMENTI CRM'
STAGING = ROOT / 'database' / 'imports' / 'konahub' / 'staging'
SUPABASE_BIN = ROOT / '.bin' / 'supabase'


def db_query(sql, timeout=180):
    result = subprocess.run(
        [str(SUPABASE_BIN), 'db', 'query', '--linked', sql],
        capture_output=True, text=True, timeout=timeout, cwd=str(ROOT)
    )
    if result.returncode != 0:
        raise RuntimeError(f"DB err: {result.stderr[:300]}\nSQL: {sql[:300]}")
    out = result.stdout
    s = out.find('{'); e = out.rfind('}')
    return json.loads(out[s:e+1])


def normalize_name_key(s):
    if not s: return ''
    s = s.upper()
    s = re.sub(r'[ÀÁÂ]', 'A', s); s = re.sub(r'[ÈÉÊ]', 'E', s)
    s = re.sub(r'[ÌÍÎ]', 'I', s); s = re.sub(r'[ÒÓÔ]', 'O', s)
    s = re.sub(r'[ÙÚÛ]', 'U', s)
    s = re.sub(r'[^A-Z0-9]', '', s)
    return s


def parse_folder(name, pattern='pda'):
    if pattern == 'protecta':
        m = re.match(r'^(.*?)\s*-\s*(\d{2})[.-](\d{2})[.-](\d{4})$', name)
        if not m: return None, None
        return normalize_name_key(m.group(1)), f"{m.group(4)}-{m.group(3)}-{m.group(2)}"
    if pattern == 'comodato':
        m = re.match(r'^Comodato_(.+?)_(\d{2})(\d{2})(\d{4})$', name)
        if not m: return None, None
        return normalize_name_key(m.group(1).replace('_','')), f"{m.group(4)}-{m.group(3)}-{m.group(2)}"
    # default
    m = re.match(r'^(.+?)_(\d{1,2})[.](\d{1,2})[.](\d{2,4})$', name)
    if not m: return None, None
    nm = m.group(1).replace('_','')
    y = m.group(4)
    if len(y) == 2: y = '20' + y
    return normalize_name_key(nm), f"{y}-{int(m.group(3)):02d}-{int(m.group(2)):02d}"


def remap_filename(orig_name, category_hint=None):
    """Rinomina al pattern Mirox + return tipo_documento."""
    lower = orig_name.lower()
    if 'pda' in lower or 'contratto' in lower:
        return 'contratto_pda.pdf', 'contratto'
    if 'identit' in lower or 'documento' in lower or 'd_identi' in lower:
        return 'documento_identita.pdf', 'documento_identita'
    if 'bolletta' in lower:
        return 'copia_bolletta.pdf', 'copia_bolletta'
    if 'sim' in lower or 'mnp' in lower:
        return 'copia_sim_mnp.pdf', 'copia_sim_mnp'
    safe = re.sub(r'[^a-zA-Z0-9._-]', '_', orig_name)
    return safe, 'altro'


def safe_filename(orig):
    """Sanitize for storage upload (no special chars)."""
    return re.sub(r'[^a-zA-Z0-9._-]', '_', orig)


def staging_clear(subdir):
    p = STAGING / subdir
    if p.exists():
        shutil.rmtree(p)


def staging_link(src, dst):
    """Hard copy (NO symlink) perche' supabase storage cp -r non segue symlink."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    shutil.copy2(src, dst)


def storage_upload_dir(local_dir, dest_path):
    """Upload directory ricorsiva con parallelismo."""
    if not local_dir.exists():
        return False, "src non esiste"
    result = subprocess.run(
        [str(SUPABASE_BIN), 'storage', 'cp', '-r', '-j', '16',
         str(local_dir) + '/', dest_path, '--linked', '--experimental'],
        capture_output=True, text=True, timeout=1800, cwd=str(ROOT)
    )
    return result.returncode == 0, result.stderr[:500]


# =====================================================================
# Module: PDA
# =====================================================================

def module_pda(execute, skip_upload=False):
    print(f"\n=== Modulo: PDA bulk ===")
    src = DOCS / 'PDA + DOC'
    if not src.exists():
        print("  src non esiste"); return

    # Pratiche Mirox
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

    folders = [f for f in src.iterdir() if f.is_dir()]
    matched = []
    unmatched = []
    for folder in folders:
        nk, di = parse_folder(folder.name, 'pda')
        if not di:
            unmatched.append(folder.name); continue
        cands = idx.get((nk, di), [])
        if not cands:
            day_matches = [p for p in pratiche if p['day'] == di]
            best = None
            for p in day_matches:
                for c in [p['ragione_sociale'], p['nome_referente']]:
                    if c and (nk in normalize_name_key(c) or normalize_name_key(c) in nk):
                        best = p; break
                if best: break
            if best: cands = [best]
        if not cands:
            unmatched.append(folder.name); continue
        matched.append((folder, cands[0]))

    print(f"  Matched: {len(matched)}, unmatched: {len(unmatched)}")

    if not execute:
        return {'matched': len(matched), 'unmatched': len(unmatched)}

    # Build staging structure
    staging_clear('pda')
    docs_to_insert = []  # (id, contratto_id, pratica_id, tipo, file_name, storage_path)
    file_count = 0
    name_collisions = defaultdict(int)
    for folder, pratica in matched:
        d = datetime.strptime(pratica['day'], '%Y-%m-%d')
        yyyy_mm = f"{d.year}/{d.month:02d}"
        cartella = pratica['nome_cartella_storage']
        for file in folder.iterdir():
            if not file.is_file(): continue
            new_name, tipo = remap_filename(file.name)
            # Anti-collision dentro stessa cartella
            key = (cartella, new_name)
            name_collisions[key] += 1
            if name_collisions[key] > 1:
                new_name = new_name.replace('.pdf', f"_{name_collisions[key]}.pdf")
            staging_path = STAGING / 'pda' / yyyy_mm / cartella / new_name
            staging_link(file, staging_path)
            file_count += 1
            if tipo != 'altro':
                storage_path = f"{yyyy_mm}/{cartella}/{new_name}"
                docs_to_insert.append((
                    str(uuid.uuid4()), pratica['contratto_id'], pratica['id'], pratica['anagrafica_id'], tipo, new_name, storage_path
                ))
    print(f"  Staging: {file_count} symlink creati. Doc records preparati: {len(docs_to_insert)}")

    # Upload
    if skip_upload:
        print(f"  [SKIP UPLOAD]")
    else:
        print(f"  Uploading...")
        ok, err = storage_upload_dir(STAGING / 'pda', 'ss:///contratti-vendita/')
        if not ok:
            print(f"  Upload error: {err[:300]}")
            return {'matched': len(matched), 'uploaded': 0, 'error': err}
        print(f"  Upload OK")

    # Batch insert vendita_documenti
    if docs_to_insert:
        BATCH = 200
        inserted = 0
        for i in range(0, len(docs_to_insert), BATCH):
            sub = docs_to_insert[i:i+BATCH]
            values = []
            for (did, cid, pid, aid, tipo, fname, spath) in sub:
                cid_sql = f"'{cid}'::uuid" if cid else 'NULL'
                values.append(
                    f"('{did}'::uuid, {cid_sql}, '{pid}'::uuid, '{aid}'::uuid, '{tipo}', "
                    f"'{fname.replace(chr(39), chr(39)*2)}', "
                    f"'contratti-vendita', '{spath.replace(chr(39), chr(39)*2)}')"
                )
            sql = (
                "INSERT INTO vendita_documenti (id, contratto_id, pratica_id, anagrafica_id, tipo_documento, "
                "file_name, storage_bucket, storage_path) VALUES "
                + ', '.join(values) + " ON CONFLICT DO NOTHING;"
            )
            db_query(sql, timeout=120)
            inserted += len(sub)
            print(f"  ...inserted docs {inserted}/{len(docs_to_insert)}")
        return {'matched': len(matched), 'uploaded': file_count, 'docs': inserted}
    return {'matched': len(matched), 'uploaded': file_count}


# =====================================================================
# Generic small-module helper (apri_chiudi, switch, comodato, protecta)
# =====================================================================

def module_generic(execute, *, name, src_subdir, bucket, db_table, db_date_col, db_filter_2026, db_match_cols, dest_prefix, folder_pattern='pda', update_col='cartella_url'):
    print(f"\n=== Modulo: {name} bulk ===")
    src = DOCS / src_subdir
    if not src.exists():
        print("  src non esiste"); return

    cols_str = ', '.join(['id', f"{db_date_col}::date AS day"] + db_match_cols)
    r = db_query(f"SELECT {cols_str} FROM {db_table} WHERE {db_filter_2026};", timeout=60)
    rows = r['rows']

    folders = [f for f in src.iterdir() if f.is_dir()]
    matched = []
    unmatched = []
    for folder in folders:
        nk, di = parse_folder(folder.name, folder_pattern)
        if not di:
            unmatched.append(folder.name); continue
        day_rows = [r for r in rows if r['day'] == di]
        if not day_rows:
            unmatched.append(folder.name); continue
        best = None
        for r2 in day_rows:
            for mc in db_match_cols:
                v = r2.get(mc)
                if v and (normalize_name_key(v) in nk or nk in normalize_name_key(v)):
                    best = r2; break
            if best: break
        if not best: best = day_rows[0]
        matched.append((folder, best))

    print(f"  DB rows: {len(rows)}, folders: {len(folders)}, matched: {len(matched)}, unmatched: {len(unmatched)}")

    if not execute:
        return {'matched': len(matched), 'unmatched': len(unmatched)}

    # Staging
    staging_clear(name)
    file_count = 0
    id_to_subdir = {}
    for folder, row in matched:
        subdir = f"{dest_prefix}_{row['id']}"
        id_to_subdir[row['id']] = subdir
        for file in folder.iterdir():
            if not file.is_file(): continue
            sf = safe_filename(file.name)
            staging_path = STAGING / name / subdir / sf
            staging_link(file, staging_path)
            file_count += 1
    print(f"  Staging: {file_count} symlink")

    ok, err = storage_upload_dir(STAGING / name, f"ss:///{bucket}/")
    if not ok:
        print(f"  Upload error: {err[:300]}")
        return {'matched': len(matched), 'uploaded': 0, 'error': err}
    print(f"  Upload OK")

    # UPDATE cartella_url batch
    if id_to_subdir:
        values = [f"({id},{json.dumps(sub + '/')})" for id, sub in id_to_subdir.items()]
        # Per Postgres usiamo VALUES con join
        sql = (
            f"UPDATE {db_table} t SET {update_col} = v.url::text "
            f"FROM (VALUES " + ', '.join([f"({id}, '{sub}/')" for id, sub in id_to_subdir.items()]) + ") "
            f"AS v(id, url) WHERE t.id = v.id;"
        )
        db_query(sql, timeout=60)
    return {'matched': len(matched), 'uploaded': file_count}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--execute', action='store_true')
    p.add_argument('--module', choices=['pda','apri_chiudi','switch','comodato','protecta'])
    p.add_argument('--skip-upload', action='store_true', help='Salta upload Storage, fai solo INSERT vendita_documenti (per PDA)')
    args = p.parse_args()
    execute = args.execute
    print(f"=== Upload Storage v2 [{'EXECUTE' if execute else 'DRY-RUN'}] ===")

    STAGING.mkdir(exist_ok=True)

    mods = [args.module] if args.module else ['comodato','protecta','apri_chiudi','switch','pda']
    results = {}
    for m in mods:
        if m == 'pda':
            results[m] = module_pda(execute, skip_upload=args.skip_upload)
        elif m == 'apri_chiudi':
            results[m] = module_generic(execute, name='apri_chiudi', src_subdir='APRI-CHIUDI',
                bucket='apri-chiudi-files', db_table='vendita_apri_chiudi',
                db_date_col='data_inserimento',
                db_filter_2026="data_inserimento >= '2026-01-01'",
                db_match_cols=['ragione_sociale_vecchio', 'ragione_sociale_nuovo'],
                dest_prefix='pratica', folder_pattern='pda')
        elif m == 'switch':
            results[m] = module_generic(execute, name='switch', src_subdir='SWITCH',
                bucket='switch-sim-files', db_table='vendita_switch_sim',
                db_date_col='data_inserimento',
                db_filter_2026="data_inserimento >= '2026-01-01'",
                db_match_cols=['ragione_sociale_attuale', 'ragione_sociale_rientro'],
                dest_prefix='pratica', folder_pattern='pda')
        elif m == 'comodato':
            results[m] = module_generic(execute, name='comodato', src_subdir='Device Comodato D_uso',
                bucket='comodato-files', db_table='post_vendita_dispositivi_comodato',
                db_date_col='data_uscita',
                db_filter_2026="data_uscita >= '2026-01-01'",
                db_match_cols=['nome', 'cognome'],
                dest_prefix='dispositivo', folder_pattern='comodato')
        elif m == 'protecta':
            results[m] = module_generic(execute, name='protecta', src_subdir='PROTECTA',
                bucket='protecta-files', db_table='vendita_simulatore_protecta',
                db_date_col='data_preventivo',
                db_filter_2026="data_preventivo >= '2026-01-01'",
                db_match_cols=['cliente'],
                dest_prefix='preventivo', folder_pattern='protecta',
                update_col='preventivo_pdf_url')

    print(f"\n=== Summary ===")
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
