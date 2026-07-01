#!/usr/bin/env python3
"""
Upload PDF dalla cartella estratta DOCUMENTI CRM ai bucket Supabase.
Match cartella konahub -> record Mirox via (data + ragsoc fuzzy).

Modalita:
    python3 upload_storage.py --dry-run [--module pda|apri_chiudi|switch|comodato|protecta]
    python3 upload_storage.py --execute --module pda
    python3 upload_storage.py --execute  # tutti
"""
import argparse
import csv
import json
import os
import re
import subprocess
import sys
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
DOCS = ROOT / 'database' / 'imports' / 'konahub' / 'docs_extract' / 'DOCUMENTI CRM'
SUPABASE_BIN = ROOT / '.bin' / 'supabase'


def db_query(sql, timeout=180):
    result = subprocess.run(
        [str(SUPABASE_BIN), 'db', 'query', '--linked', sql],
        capture_output=True, text=True, timeout=timeout, cwd=str(ROOT)
    )
    if result.returncode != 0:
        raise RuntimeError(f"DB err: {result.stderr[:300]}\nSQL: {sql[:200]}")
    out = result.stdout
    s = out.find('{'); e = out.rfind('}')
    return json.loads(out[s:e+1])


def normalize_name_key(s):
    """Normalize ragsoc per match: uppercase, no spazi, no accenti."""
    if not s:
        return ''
    s = s.upper()
    s = re.sub(r'[ÀÁÂ]', 'A', s)
    s = re.sub(r'[ÈÉÊ]', 'E', s)
    s = re.sub(r'[ÌÍÎ]', 'I', s)
    s = re.sub(r'[ÒÓÔ]', 'O', s)
    s = re.sub(r'[ÙÚÛ]', 'U', s)
    s = re.sub(r'[^A-Z0-9]', '', s)
    return s


def parse_konahub_folder(folder_name, pattern='pda'):
    """Estrai (name_key, date_iso) dal nome cartella konahub.
    pattern 'pda':  NOME_COGNOME_DD.MM.YYYY -> (NOMECOGNOME, 2026-MM-DD)
    pattern 'apri': OLD_NEW_DD.MM.YYYY     -> stesso
    pattern 'switch': NOME_DD.MM.YYYY      -> stesso
    pattern 'protecta': NOME COGNOME - DD-MM-YYYY -> (NOMECOGNOME, 2026-MM-DD)
    pattern 'comodato': Comodato_NOME_COGNOME_DDMMYYYY -> stesso
    pattern 'segnal': Segnalazione_NOME_COGNOME_DD.MM.YY -> stesso
    """
    if pattern == 'protecta':
        # Es: "YOUSSEF ER RAHMOUNY - 26-06-2026"
        m = re.match(r'^(.*?)\s*-\s*(\d{2})[.-](\d{2})[.-](\d{4})$', folder_name)
        if not m:
            return None, None
        name = m.group(1)
        d, mo, y = m.group(2), m.group(3), m.group(4)
        return normalize_name_key(name), f"{y}-{mo}-{d}"
    if pattern == 'comodato':
        # Es: "Comodato_MICHAEL_TOMMELLERI_05022026"
        m = re.match(r'^Comodato_(.+?)_(\d{2})(\d{2})(\d{4})$', folder_name)
        if not m:
            return None, None
        name = m.group(1).replace('_', '')
        d, mo, y = m.group(2), m.group(3), m.group(4)
        return normalize_name_key(name), f"{y}-{mo}-{d}"
    if pattern == 'segnal':
        # Es: "Segnalazione_FRANCO_MAURIZIO_04.04.26"
        m = re.match(r'^Segnalazione_(.+?)_(\d{1,2})[.-](\d{1,2})[.-](\d{2,4})$', folder_name)
        if not m:
            return None, None
        name = m.group(1).replace('_', '')
        d, mo, y = m.group(2), m.group(3), m.group(4)
        if len(y) == 2: y = '20' + y
        return normalize_name_key(name), f"{y}-{int(mo):02d}-{int(d):02d}"
    # Default 'pda', 'apri', 'switch': <name>_DD.MM.YYYY
    m = re.match(r'^(.+?)_(\d{1,2})[.](\d{1,2})[.](\d{2,4})$', folder_name)
    if not m:
        return None, None
    name = m.group(1).replace('_', '')
    d, mo, y = m.group(2), m.group(3), m.group(4)
    if len(y) == 2: y = '20' + y
    return normalize_name_key(name), f"{y}-{int(mo):02d}-{int(d):02d}"


def storage_cp(local_path, dest_path, retries=2):
    """Upload single file. Returns True on success."""
    for attempt in range(retries):
        try:
            result = subprocess.run(
                [str(SUPABASE_BIN), 'storage', 'cp', str(local_path), dest_path,
                 '--linked', '--experimental'],
                capture_output=True, text=True, timeout=60, cwd=str(ROOT)
            )
            if result.returncode == 0:
                return True
        except subprocess.TimeoutExpired:
            pass
    return False


def storage_cp_dir(local_dir, dest_path, jobs=8, timeout=600):
    """Upload directory recursive."""
    result = subprocess.run(
        [str(SUPABASE_BIN), 'storage', 'cp', '-r', '-j', str(jobs),
         str(local_dir), dest_path, '--linked', '--experimental'],
        capture_output=True, text=True, timeout=timeout, cwd=str(ROOT)
    )
    return result.returncode == 0, result.stderr[:500] if result.returncode != 0 else ''


# =====================================================================
# Module: PDA + DOC -> bucket contratti-vendita
# =====================================================================

def module_pda(execute):
    print(f"\n=== Modulo: PDA + DOC -> contratti-vendita ===")
    src_dir = DOCS / 'PDA + DOC'
    if not src_dir.exists():
        print(f"  ERR src non esistente: {src_dir}")
        return

    # Carica pratiche Mirox: nome_cartella_storage parts + anag info
    r = db_query("""
        SELECT vp.id AS pratica_id, vp.nome_cartella_storage, vp.data_pratica::date AS day,
               a.ragione_sociale, a.nome_referente
        FROM vendita_pratiche vp
        JOIN anagrafica a ON a.id = vp.anagrafica_id
        WHERE vp.data_pratica >= '2026-01-01';
    """, timeout=60)
    pratiche = r.get('rows', [])
    print(f"  Pratiche Mirox 2026: {len(pratiche)}")

    # Index: (name_key, date) -> [pratiche]
    idx = defaultdict(list)
    for p in pratiche:
        # name_key da ragione_sociale + nome_referente per fuzzy
        for cand in [p['ragione_sociale'], p['nome_referente']]:
            if cand:
                idx[(normalize_name_key(cand), p['day'])].append(p)

    # Scansiona cartelle
    folders = [f for f in src_dir.iterdir() if f.is_dir()]
    print(f"  Cartelle konahub: {len(folders)}")

    matched = []
    unmatched = []
    for folder in folders:
        name_key, date_iso = parse_konahub_folder(folder.name, 'pda')
        if not name_key or not date_iso:
            unmatched.append(folder.name)
            continue
        cands = idx.get((name_key, date_iso), [])
        if not cands:
            # Fuzzy: cerco solo per data, poi best match per nome
            day_matches = [p for p in pratiche if p['day'] == date_iso]
            if not day_matches:
                unmatched.append(folder.name)
                continue
            # Best match: substring containment
            best = None
            for p in day_matches:
                for cand_name in [p['ragione_sociale'], p['nome_referente']]:
                    if cand_name and (name_key in normalize_name_key(cand_name) or normalize_name_key(cand_name) in name_key):
                        best = p
                        break
                if best: break
            if best:
                cands = [best]
        if not cands:
            unmatched.append(folder.name)
            continue
        matched.append((folder, cands[0]))

    print(f"  Matched: {len(matched)}, unmatched: {len(unmatched)}")
    if unmatched[:5]:
        print(f"  Sample unmatched: {unmatched[:5]}")

    if not execute:
        return {'matched': len(matched), 'unmatched': len(unmatched)}

    # Upload + crea vendita_documenti
    uploaded = 0
    docs_inserted = 0
    failed = []
    for folder, pratica in matched:
        # Estrai YYYY/MM dalla data_pratica
        d = datetime.strptime(pratica['day'], '%Y-%m-%d')
        yyyy_mm = f"{d.year}/{d.month:02d}"
        cartella_mirox = pratica['nome_cartella_storage']
        for file in folder.iterdir():
            if not file.is_file():
                continue
            # Normalize filename
            base_name = file.name
            # Rinomina via convention Mirox
            lower = base_name.lower()
            if 'pda' in lower or 'contratto' in lower:
                new_name = 'contratto_pda.pdf'
                tipo_doc = 'contratto'
            elif 'identit' in lower or 'documento' in lower:
                new_name = 'documento_identita.pdf'
                tipo_doc = 'documento_identita'
            elif 'bolletta' in lower:
                new_name = 'copia_bolletta.pdf'
                tipo_doc = 'copia_bolletta'
            elif 'sim' in lower or 'mnp' in lower:
                new_name = 'copia_sim_mnp.pdf'
                tipo_doc = 'copia_sim_mnp'
            else:
                new_name = re.sub(r'[^a-zA-Z0-9._-]', '_', base_name)
                tipo_doc = 'altro'

            dest = f"ss:///contratti-vendita/{yyyy_mm}/{cartella_mirox}/{new_name}"
            ok = storage_cp(file, dest)
            if not ok:
                failed.append(f"{folder.name}/{file.name}")
                continue
            uploaded += 1
            # INSERT vendita_documenti (skip su 'altro')
            if tipo_doc != 'altro':
                doc_id = str(uuid.uuid4())
                sql_path = f"{yyyy_mm}/{cartella_mirox}/{new_name}"
                # Get contratto_id: prendi il primo contratto della pratica
                try:
                    rc = db_query(f"SELECT id FROM vendita_contratti WHERE pratica_id = '{pratica['pratica_id']}'::uuid LIMIT 1;", timeout=30)
                    if rc['rows']:
                        contratto_id = rc['rows'][0]['id']
                        sql = (
                            f"INSERT INTO vendita_documenti (id, contratto_id, pratica_id, tipo_documento, file_name, file_url, storage_bucket, storage_path) "
                            f"VALUES ('{doc_id}'::uuid, '{contratto_id}'::uuid, '{pratica['pratica_id']}'::uuid, "
                            f"'{tipo_doc}', '{new_name}', '{sql_path}', 'contratti-vendita', '{sql_path}') "
                            f"ON CONFLICT DO NOTHING;"
                        )
                        db_query(sql, timeout=30)
                        docs_inserted += 1
                except Exception as ex:
                    pass  # vendita_documenti non critico
        if uploaded % 100 < 5 and uploaded > 0:
            print(f"  ... uploaded {uploaded} files")

    print(f"  Uploaded: {uploaded} files, docs inserted: {docs_inserted}, failed: {len(failed)}")
    return {'matched': len(matched), 'uploaded': uploaded, 'docs': docs_inserted, 'failed': len(failed)}


# =====================================================================
# Module: apri_chiudi
# =====================================================================

def module_apri_chiudi(execute):
    print(f"\n=== Modulo: APRI-CHIUDI -> apri-chiudi-files ===")
    src_dir = DOCS / 'APRI-CHIUDI'
    if not src_dir.exists():
        print(f"  ERR src non esistente")
        return

    r = db_query("""
        SELECT id, data_inserimento::date AS day, ragione_sociale_vecchio, ragione_sociale_nuovo
        FROM vendita_apri_chiudi WHERE data_inserimento >= '2026-01-01';
    """, timeout=60)
    rows = r.get('rows', [])
    idx = defaultdict(list)
    for row in rows:
        for cand in [row['ragione_sociale_vecchio'], row['ragione_sociale_nuovo']]:
            if cand:
                idx[(normalize_name_key(cand), row['day'])].append(row)

    folders = [f for f in src_dir.iterdir() if f.is_dir()]
    print(f"  DB rows: {len(rows)}, cartelle konahub: {len(folders)}")

    matched = []
    unmatched = []
    for folder in folders:
        # APRI: name pattern OLD_NEW_DD.MM.YYYY - meglio cerco solo per data, poi fuzzy
        m = re.search(r'_(\d{1,2})\.(\d{1,2})\.(\d{4})$', folder.name)
        if not m:
            unmatched.append(folder.name)
            continue
        day_iso = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
        # Tutti gli apri_chiudi di quel giorno
        day_matches = [r for r in rows if r['day'] == day_iso]
        if not day_matches:
            unmatched.append(folder.name)
            continue
        # Match fuzzy: il nome cartella contiene OLD_NEW. Cerca primo che ha entrambi
        folder_key = normalize_name_key(folder.name)
        best = None
        for r2 in day_matches:
            v_key = normalize_name_key(r2['ragione_sociale_vecchio'] or '')
            n_key = normalize_name_key(r2['ragione_sociale_nuovo'] or '')
            if v_key and v_key in folder_key:
                best = r2; break
        if not best:
            best = day_matches[0]  # fallback first
        matched.append((folder, best))

    print(f"  Matched: {len(matched)}, unmatched: {len(unmatched)}")

    if not execute:
        return {'matched': len(matched), 'unmatched': len(unmatched)}

    uploaded = 0
    failed = []
    for folder, row in matched:
        for file in folder.iterdir():
            if not file.is_file(): continue
            safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', file.name)
            dest = f"ss:///apri-chiudi-files/pratica_{row['id']}/{safe_name}"
            ok = storage_cp(file, dest)
            if ok: uploaded += 1
            else: failed.append(f"{folder.name}/{file.name}")
        # Update cartella_url
        db_query(f"UPDATE vendita_apri_chiudi SET cartella_url = 'pratica_{row['id']}/' WHERE id = {row['id']};", timeout=30)
    print(f"  Uploaded: {uploaded} files, failed: {len(failed)}")
    return {'matched': len(matched), 'uploaded': uploaded, 'failed': len(failed)}


# =====================================================================
# Module: switch
# =====================================================================

def module_switch(execute):
    print(f"\n=== Modulo: SWITCH -> switch-sim-files ===")
    src_dir = DOCS / 'SWITCH'
    if not src_dir.exists():
        print(f"  ERR src non esistente")
        return

    r = db_query("""
        SELECT id, data_inserimento::date AS day, ragione_sociale_attuale, ragione_sociale_rientro
        FROM vendita_switch_sim WHERE data_inserimento >= '2026-01-01';
    """, timeout=60)
    rows = r.get('rows', [])
    folders = [f for f in src_dir.iterdir() if f.is_dir()]
    print(f"  DB rows: {len(rows)}, cartelle konahub: {len(folders)}")

    matched = []
    unmatched = []
    for folder in folders:
        name_key, date_iso = parse_konahub_folder(folder.name, 'pda')  # stesso pattern
        if not date_iso:
            unmatched.append(folder.name); continue
        day_matches = [r for r in rows if r['day'] == date_iso]
        if not day_matches:
            unmatched.append(folder.name); continue
        best = None
        for r2 in day_matches:
            for cand in [r2['ragione_sociale_attuale'], r2['ragione_sociale_rientro']]:
                if cand and (normalize_name_key(cand) in name_key or name_key in normalize_name_key(cand)):
                    best = r2; break
            if best: break
        if not best:
            best = day_matches[0]
        matched.append((folder, best))

    print(f"  Matched: {len(matched)}, unmatched: {len(unmatched)}")

    if not execute:
        return {'matched': len(matched), 'unmatched': len(unmatched)}

    uploaded = 0
    for folder, row in matched:
        for file in folder.iterdir():
            if not file.is_file(): continue
            safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', file.name)
            dest = f"ss:///switch-sim-files/pratica_{row['id']}/{safe_name}"
            if storage_cp(file, dest): uploaded += 1
        db_query(f"UPDATE vendita_switch_sim SET cartella_url = 'pratica_{row['id']}/' WHERE id = {row['id']};", timeout=30)
    print(f"  Uploaded: {uploaded} files")
    return {'matched': len(matched), 'uploaded': uploaded}


# =====================================================================
# Module: comodato
# =====================================================================

def module_comodato(execute):
    print(f"\n=== Modulo: Comodato -> comodato-files ===")
    src_dir = DOCS / 'Device Comodato D_uso'
    if not src_dir.exists():
        print(f"  ERR src non esistente")
        return

    r = db_query("""
        SELECT id, data_uscita AS day, nome, cognome
        FROM post_vendita_dispositivi_comodato WHERE data_uscita >= '2026-01-01';
    """, timeout=60)
    rows = r.get('rows', [])
    folders = [f for f in src_dir.iterdir() if f.is_dir()]

    matched = []
    unmatched = []
    for folder in folders:
        name_key, date_iso = parse_konahub_folder(folder.name, 'comodato')
        if not date_iso:
            unmatched.append(folder.name); continue
        day_matches = [r for r in rows if r['day'] == date_iso]
        if not day_matches:
            unmatched.append(folder.name); continue
        best = None
        for r2 in day_matches:
            cand = normalize_name_key((r2['nome'] or '') + (r2['cognome'] or ''))
            if cand in name_key or name_key in cand:
                best = r2; break
        if not best:
            best = day_matches[0]
        matched.append((folder, best))

    print(f"  Matched: {len(matched)}, unmatched: {len(unmatched)}, DB rows: {len(rows)}")

    if not execute:
        return {'matched': len(matched), 'unmatched': len(unmatched)}

    uploaded = 0
    for folder, row in matched:
        for file in folder.iterdir():
            if not file.is_file(): continue
            safe = re.sub(r'[^a-zA-Z0-9._-]', '_', file.name)
            dest = f"ss:///comodato-files/dispositivo_{row['id']}/{safe}"
            if storage_cp(file, dest): uploaded += 1
        db_query(f"UPDATE post_vendita_dispositivi_comodato SET cartella_url = 'dispositivo_{row['id']}/' WHERE id = {row['id']};", timeout=30)
    print(f"  Uploaded: {uploaded} files")
    return {'matched': len(matched), 'uploaded': uploaded}


# =====================================================================
# Module: protecta
# =====================================================================

def module_protecta(execute):
    print(f"\n=== Modulo: Protecta -> protecta-files ===")
    src_dir = DOCS / 'PROTECTA'
    if not src_dir.exists():
        return

    r = db_query("""
        SELECT id, data_preventivo::date AS day, cliente
        FROM vendita_simulatore_protecta WHERE data_preventivo >= '2026-01-01';
    """, timeout=60)
    rows = r.get('rows', [])
    folders = [f for f in src_dir.iterdir() if f.is_dir()]

    matched = []
    unmatched = []
    for folder in folders:
        name_key, date_iso = parse_konahub_folder(folder.name, 'protecta')
        if not date_iso:
            unmatched.append(folder.name); continue
        day_matches = [r for r in rows if r['day'] == date_iso]
        if not day_matches:
            unmatched.append(folder.name); continue
        best = None
        for r2 in day_matches:
            if normalize_name_key(r2['cliente']) in name_key or name_key in normalize_name_key(r2['cliente']):
                best = r2; break
        if not best: best = day_matches[0]
        matched.append((folder, best))

    print(f"  Matched: {len(matched)}, unmatched: {len(unmatched)}, DB rows: {len(rows)}")

    if not execute:
        return {'matched': len(matched), 'unmatched': len(unmatched)}

    uploaded = 0
    for folder, row in matched:
        for file in folder.iterdir():
            if not file.is_file(): continue
            safe = re.sub(r'[^a-zA-Z0-9._-]', '_', file.name)
            dest = f"ss:///protecta-files/preventivo_{row['id']}/{safe}"
            if storage_cp(file, dest): uploaded += 1
        db_query(f"UPDATE vendita_simulatore_protecta SET preventivo_pdf_url = 'preventivo_{row['id']}/' WHERE id = {row['id']};", timeout=30)
    print(f"  Uploaded: {uploaded} files")
    return {'matched': len(matched), 'uploaded': uploaded}


# =====================================================================
# Entrypoint
# =====================================================================

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--execute', action='store_true')
    p.add_argument('--module', choices=['pda', 'apri_chiudi', 'switch', 'comodato', 'protecta'])
    args = p.parse_args()

    execute = args.execute
    mode = 'EXECUTE' if execute else 'DRY-RUN'
    print(f"=== Upload storage konahub [{mode}] ===")

    mods = [args.module] if args.module else ['comodato', 'protecta', 'apri_chiudi', 'switch', 'pda']

    results = {}
    for m in mods:
        if m == 'pda':
            results[m] = module_pda(execute)
        elif m == 'apri_chiudi':
            results[m] = module_apri_chiudi(execute)
        elif m == 'switch':
            results[m] = module_switch(execute)
        elif m == 'comodato':
            results[m] = module_comodato(execute)
        elif m == 'protecta':
            results[m] = module_protecta(execute)

    print(f"\n=== Summary ===")
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
