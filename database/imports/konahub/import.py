#!/usr/bin/env python3
"""
Import konahub -> Mirox.

Modalita d'uso:
    python3 import.py --dry-run              # default: parsing + report, no DB write
    python3 import.py --module anagrafica    # esegue solo modulo specificato
    python3 import.py --execute              # esegue tutti i moduli in ordine FK-safe
    python3 import.py --execute --module contratti  # esegue solo un modulo (in scrittura)

I CSV devono stare in database/imports/konahub/.
Il DB e' raggiunto via .bin/supabase db query --linked (PAT, no DB password).
"""

import csv
import json
import os
import re
import subprocess
import sys
import uuid
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

# Repo root
ROOT = Path(__file__).resolve().parent.parent.parent.parent
CSV_DIR = ROOT / 'database' / 'imports' / 'konahub'
SUPABASE_BIN = ROOT / '.bin' / 'supabase'

# Repo root: /Users/mirkopiasenti/Desktop/MIROX_COMPLETO

# =====================================================================
# DB helper
# =====================================================================

def db_query(sql: str, timeout: int = 120) -> dict:
    """Esegue SQL via Supabase CLI Management API. Ritorna dict {rows: [...]} o solleva."""
    result = subprocess.run(
        [str(SUPABASE_BIN), 'db', 'query', '--linked', sql],
        capture_output=True, text=True, timeout=timeout, cwd=str(ROOT)
    )
    out = result.stdout
    if result.returncode != 0:
        raise RuntimeError(f"DB query failed (exit {result.returncode}):\nSQL: {sql[:500]}\nSTDERR: {result.stderr[:500]}")
    start = out.find('{')
    end = out.rfind('}')
    if start == -1:
        raise RuntimeError(f"No JSON in output:\n{out[:500]}")
    try:
        return json.loads(out[start:end+1])
    except json.JSONDecodeError as e:
        raise RuntimeError(f"JSON parse error: {e}\nOutput: {out[:500]}")


def db_exec(sql: str, timeout: int = 120) -> dict:
    """Wrapper per INSERT/UPDATE/DELETE statements. Ritorna dict (puo' avere 'rows' vuoto)."""
    return db_query(sql, timeout=timeout)


def sql_str(s) -> str:
    """Quote string for SQL. None -> NULL."""
    if s is None:
        return 'NULL'
    s = str(s).replace("'", "''")
    return f"'{s}'"


def sql_num(n) -> str:
    """Numeric or NULL."""
    if n is None or n == '':
        return 'NULL'
    return str(n)


def sql_bool(b) -> str:
    if b is None:
        return 'NULL'
    return 'TRUE' if b else 'FALSE'


def sql_uuid(u) -> str:
    if not u:
        return 'NULL'
    return f"'{u}'::uuid"


# =====================================================================
# Normalizers
# =====================================================================

ITA_MONTHS = {
    1: '01', 2: '02', 3: '03', 4: '04', 5: '05', 6: '06',
    7: '07', 8: '08', 9: '09', 10: '10', 11: '11', 12: '12'
}


def normalize_date(s, default_time='10:00:00'):
    """Normalizza data konahub a ISO. Accetta formati:
    - DD/MM/YYYY
    - D/M/YYYY
    - DD.MM.YYYY
    - DD/MM/YY (es: 26/02/26)
    - DD/MM/YYYY HH.MM.SS
    - DD/MM/YYYY, HH:MM:SS (PROTECTA)
    Ritorna ISO 'YYYY-MM-DD HH:MM:SS+00' o None.
    """
    if not s or s == '':
        return None
    s = s.strip().replace(',', '')

    # Estraggo data e tempo
    # Tempo formato: HH.MM.SS o HH:MM:SS
    m = re.search(r'(\d{1,2}[./]\d{1,2}[./]\d{2,4})(?:\s+(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?)?', s)
    if not m:
        return None
    date_part = m.group(1)
    hh = m.group(2) or default_time.split(':')[0]
    mm = m.group(3) or default_time.split(':')[1]
    ss = m.group(4) or default_time.split(':')[2]

    # Parse data
    sep = '/' if '/' in date_part else '.'
    parts = date_part.split(sep)
    if len(parts) != 3:
        return None
    try:
        d = int(parts[0])
        mo = int(parts[1])
        y = int(parts[2])
        if y < 100:
            y += 2000
        # Limit pythonic
        if not (1 <= d <= 31 and 1 <= mo <= 12 and 2020 <= y <= 2030):
            return None
        return f"{y:04d}-{mo:02d}-{d:02d} {int(hh):02d}:{int(mm):02d}:{int(ss):02d}+00"
    except (ValueError, IndexError):
        return None


def is_2026_or_later(iso_date):
    """Filtro 01/01/2026. Accetta ISO date string."""
    if not iso_date:
        return False
    return iso_date >= '2026-01-01'


def normalize_cluster(s):
    """Konahub: CONSUMER, CONSUMER - PASSAPORTO, CONSUMER - CONVERGENZA INTERNA, BUSINESS, Consumer, Business
    Mirox: Consumer | Business
    """
    if not s:
        return 'Consumer'  # default
    up = s.strip().upper()
    if up.startswith('CONSUMER') or up.startswith('CARMELO'):
        return 'Consumer'
    if up.startswith('BUSINESS') or up.startswith('MARILISA'):
        return 'Business'
    # Fallback: cluster vuoto o sconosciuto -> Consumer
    return 'Consumer'


# CF italiano (16 alpha-num) o PIVA (11 cifre). Resto = passaporto.
RE_CF = re.compile(r'^[A-Z0-9]{16}$')
RE_PIVA = re.compile(r'^\d{11}$')


def normalize_cf_piva(s):
    """Trim + upper. Auto-pad zeri leading per PIVA brevi (10 cifre)."""
    if not s:
        return None
    v = s.strip().upper()
    if not v:
        return None
    # Auto-pad PIVA 10 cifre
    if re.fullmatch(r'\d{10}', v):
        v = '0' + v
    return v


def is_passaporto(cf):
    """True se non e' ne CF ne PIVA standard."""
    if not cf:
        return False
    return not RE_CF.fullmatch(cf) and not RE_PIVA.fullmatch(cf)


def normalize_operatore_name(s):
    """Mapping operatore konahub -> nome profilo Mirox.
    Cerea -> None (lascia operatore_id NULL fino a creazione profilo).
    Vuoto/sconosciuto -> None.
    """
    if not s:
        return None
    n = s.strip()
    if not n:
        return None
    # Casi misti tipo 'MIRKO-MATTEO', 'MATTEO-FRANCESCA', 'mirko - francesca'
    # Prendo il primo nome
    n = re.split(r'[-/]| - |,', n)[0].strip()
    n_lower = n.lower()
    if n_lower in ('matteo',):
        return 'Matteo'
    if n_lower in ('mirko',):
        return 'Mirko'
    if n_lower in ('francesca', 'francesca???'):
        return 'Francesca'
    if n_lower in ('isabella',):
        return 'Isabella'
    if n_lower in ('cerea',):
        return None  # Mappa NULL temporaneo, utente creera' profilo
    # Sconosciuti: NULL
    return None


# Cluster suffix per metadati: e' utile loggare per report?
def cluster_meta(s):
    """Tipo cluster originale konahub (per log/report)."""
    up = (s or '').strip().upper()
    if 'PASSAPORTO' in up:
        return 'PASSAPORTO'
    if 'CONVERGENZA INTERNA' in up:
        return 'CONVERGENZA_INTERNA'
    return None


# =====================================================================
# Lookups
# =====================================================================

class Lookups:
    def __init__(self):
        self.categorie = {}  # nome_mirox -> id
        self.offerte = {}    # (categoria_id, cluster, nome_offerta_norm) -> (id, nome_offerta_real)
        self.opzioni = {}    # nome_norm -> (id, nome_real)
        self.profili = {}    # nome -> id
        self.anagrafica = {} # cf_piva (upper trim) -> id

    def load_all(self):
        print("Loading lookups from DB...", file=sys.stderr)
        # categorie
        r = db_query("SELECT id, nome FROM vendita_categorie;")
        for row in r.get('rows', []):
            self.categorie[row['nome']] = row['id']

        # offerte
        r = db_query("SELECT vo.id, vo.nome_offerta, vo.cluster_cliente, vo.categoria_id FROM vendita_offerte vo;")
        for row in r.get('rows', []):
            key = (row['categoria_id'], row['cluster_cliente'], row['nome_offerta'].strip().lower())
            self.offerte[key] = (row['id'], row['nome_offerta'])

        # opzioni
        r = db_query("SELECT id, nome_opzione FROM vendita_opzioni;")
        for row in r.get('rows', []):
            self.opzioni[row['nome_opzione'].strip().lower()] = (row['id'], row['nome_opzione'])

        # profili (lookup nome -> id)
        r = db_query("SELECT id, nome FROM profili WHERE attivo IS TRUE;")
        for row in r.get('rows', []):
            self.profili[row['nome']] = row['id']

        # anagrafica esistente (per dedupe)
        r = db_query("SELECT id, UPPER(TRIM(cf_piva)) AS cf, cluster, ragione_sociale FROM anagrafica;", timeout=180)
        for row in r.get('rows', []):
            if row['cf']:
                self.anagrafica[row['cf']] = row['id']

        print(f"  categorie: {len(self.categorie)}", file=sys.stderr)
        print(f"  offerte: {len(self.offerte)}", file=sys.stderr)
        print(f"  opzioni: {len(self.opzioni)}", file=sys.stderr)
        print(f"  profili: {len(self.profili)}", file=sys.stderr)
        print(f"  anagrafica esistente: {len(self.anagrafica)}", file=sys.stderr)

    def categoria_id(self, cat_konahub):
        """Mappa categoria konahub -> uuid Mirox."""
        mapping = {
            'Mobile': 'Mobile',
            'CB': 'Customer Base',
            'Fisso': 'Fisso',
            'Energia': 'Energia',
            'Allarme': 'Allarmi',
            'Assicurazione': 'Assicurazioni',
        }
        mirox_name = mapping.get((cat_konahub or '').strip())
        return self.categorie.get(mirox_name) if mirox_name else None

    def categoria_name_mirox(self, cat_konahub):
        mapping = {
            'Mobile': 'Mobile',
            'CB': 'Customer Base',
            'Fisso': 'Fisso',
            'Energia': 'Energia',
            'Allarme': 'Allarmi',
            'Assicurazione': 'Assicurazioni',
        }
        return mapping.get((cat_konahub or '').strip())

    def offerta_lookup(self, cat_konahub, offerta_konahub, cluster_norm):
        """Lookup offerta konahub -> (id, nome_offerta_mirox) o (None, name_used).
        Applica mapping speciali (Tied generico, Protecta -> W3 Protetti, FWA OUTDOOR -> FWA - OUTDOOR).
        """
        cat_id = self.categoria_id(cat_konahub)
        if not cat_id:
            return (None, offerta_konahub)
        off = (offerta_konahub or '').strip()
        # Mapping speciali
        REMAP = {
            'Tied (8,99 - 9,99)': 'Tied',
            'Tied (12,99 - 14,99)': 'Tied',
            'Tied - Underground (4,99 - 5,99 - 6,99 - 7,99)': 'Tied - Underground (4,99 - 5,99 - 6,99)',
            'FWA OUTDOOR': 'FWA - OUTDOOR',
            'Protecta Casa - 499€ + 39€/MESE': 'W3 Protetti Casa - 499€ + 39€/MESE',
            'Protecta Business - 599€+iva + 39€/mese+iva': 'W3 Protetti Business - 599€+iva + 39€/mese+iva',
            'Professional Flex': 'Professional Flex - Professional Special',
        }
        off_mapped = REMAP.get(off, off)
        # Lookup
        key = (cat_id, cluster_norm, off_mapped.lower())
        if key in self.offerte:
            return self.offerte[key]
        # Fallback: prova l'altro cluster
        other = 'Business' if cluster_norm == 'Consumer' else 'Consumer'
        key2 = (cat_id, other, off_mapped.lower())
        if key2 in self.offerte:
            return self.offerte[key2]
        return (None, off_mapped)

    def opzione_lookup(self, opzione_konahub):
        """Lookup opzione. Valori sospetti '99 - 5/9/14' -> 'Nessuna opzione'.
        'Seleziona opzione' / vuoto -> NULL.
        """
        if not opzione_konahub:
            return (None, None)
        v = opzione_konahub.strip()
        if not v or v.lower() in ('seleziona opzione',):
            return (None, None)
        # Valori sospetti
        if re.match(r'^99\s*-\s*\d+', v):
            v = 'Nessuna opzione'
        # Mapping MNP konahub piu lungo -> Mirox piu corto
        if 'iliad' in v.lower() and 'fastweb' in v.lower():
            v = 'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali'
        lk = self.opzioni.get(v.lower())
        if lk:
            return lk
        # Fallback Nessuna opzione
        return self.opzioni.get('nessuna opzione', (None, None))

    def profilo_id(self, op_name):
        """Lookup operatore name -> profilo uuid."""
        if not op_name:
            return None
        return self.profili.get(op_name)


# =====================================================================
# Module: contratti CSV parsing
# =====================================================================

def load_contratti_csv():
    """Ritorna lista di dict pronti per import.
    Filtra 2026+. Normalizza tutti i campi.
    """
    path = CSV_DIR / 'contratti.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[1]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[2:]

    out = []
    skipped_pre2026 = 0
    skipped_invalid_date = 0
    for r in data:
        data_str = r[col['Data Upload']]
        iso = normalize_date(data_str)
        if not iso:
            skipped_invalid_date += 1
            continue
        if not is_2026_or_later(iso):
            skipped_pre2026 += 1
            continue
        rec = {
            'data_contratto_iso': iso,
            'operatore_name': normalize_operatore_name(r[col['Operatore']]),
            'operatore_name_raw': r[col['Operatore']].strip(),
            'cluster_raw': r[col['Cluster']].strip(),
            'cluster_norm': normalize_cluster(r[col['Cluster']]),
            'cluster_meta': cluster_meta(r[col['Cluster']]),
            'cf_piva_raw': r[col['CF / P.IVA']].strip(),
            'cf_piva': normalize_cf_piva(r[col['CF / P.IVA']]),
            'ragione_sociale': r[col['Ragione Sociale']].strip(),
            'nome_referente': r[col['Nome Referente']].strip(),
            'cellulare': r[col['Cellulare']].strip(),
            'categoria_konahub': r[col['Categoria']].strip(),
            'offerta_konahub': r[col['Offerta']].strip(),
            'opzione_konahub': r[col['Opzione']].strip() if 'Opzione' in col else r[col.get('Opzione ', -1)].strip() if col.get('Opzione ', -1) >= 0 else '',
            'punteggio_offerta': r[col['Punteggio Offerta']].strip().replace(',', '.') if 'Punteggio Offerta' in col else '0',
            'punteggio_opzione': r[col['Punteggio Opzione']].strip().replace(',', '.') if 'Punteggio Opzione' in col else '0',
            'tipo_attivazione': (r[col['TIpologia Fisso']].strip() if 'TIpologia Fisso' in col else ''),
            'apri_chiudi': (r[col['Apri/Chiudi']].strip() if 'Apri/Chiudi' in col else ''),
            'intestatario': (r[col['Intestario']].strip() if 'Intestario' in col else ''),
            'switch_sim': (r[col['Eseguito']].strip() if 'Eseguito' in col else ''),
            'modalita_pagamento': (r[col['Pagamento']].strip() if 'Pagamento' in col else ''),
            'dispositivo': (r[col['Dispositivo']].strip() if 'Dispositivo' in col else ''),
            'imei': (r[col['IMEI']].strip() if 'IMEI' in col else ''),
            'fascia_prezzo': (r[col['Fascia Prezzo']].strip() if 'Fascia Prezzo' in col else ''),
            'tipo_acquisto': (r[col['Tipo Acquisto']].strip() if 'Tipo Acquisto' in col else ''),
            'finanziaria': (r[col['Finanziaria']].strip() if 'Finanziaria' in col else ''),
            'kolme': (r[col['Kolme']].strip() if 'Kolme' in col else ''),
            'provincia': (r[col['Provincia']].strip() if 'Provincia' in col else ''),
            'comune': (r[col['Comune']].strip() if 'Comune' in col else ''),
            'via': (r[col['Via']].strip() if 'Via' in col else ''),
            'civico': (r[col['Civico']].strip() if 'Civico' in col else ''),
            'verificato': (r[col['Verificato?']].strip() if 'Verificato?' in col else ''),
        }
        out.append(rec)
    return out, skipped_pre2026, skipped_invalid_date


# =====================================================================
# Module: anagrafica (dry-run + execute)
# =====================================================================

def module_anagrafica(lookups: Lookups, contratti_data: list, execute: bool):
    """Crea le anagrafiche mancanti."""
    # Estrai anagrafica uniche dai contratti
    seen = {}
    for c in contratti_data:
        cf = c['cf_piva']
        if not cf:
            continue
        if cf in seen:
            continue
        seen[cf] = c

    # Filtra solo quelle NUOVE (non in DB)
    nuove = []
    aggiorn = []
    for cf, c in seen.items():
        if cf in lookups.anagrafica:
            # potrebbe richiedere update (es. cellulare nuovo, indirizzo nuovo)
            # Per ora skip update (anagrafica e' "gia' a posto" per utente)
            continue
        nuove.append(c)

    print(f"\n=== Modulo: anagrafica ===")
    print(f"  Anagrafiche uniche nei contratti 2026: {len(seen)}")
    print(f"  Gia presenti in DB: {len(seen) - len(nuove)}")
    print(f"  Da inserire (NUOVE): {len(nuove)}")
    print(f"  di cui passaporto: {sum(1 for n in nuove if is_passaporto(n['cf_piva']))}")

    if not nuove:
        return {'inserted': 0, 'skipped': 0}

    if not execute:
        print(f"  [DRY-RUN] Niente inserito")
        # Popola cache con uuid simulati cosi i moduli successivi possono fare lookup
        for n in nuove:
            lookups.anagrafica[n['cf_piva']] = str(uuid.uuid4())
        # Sample
        for n in nuove[:5]:
            print(f"    - cf={n['cf_piva']} cluster={n['cluster_norm']} ragsoc={n['ragione_sociale'][:30]!r}")
        return {'inserted': 0, 'skipped': len(nuove), 'would_insert': len(nuove)}

    # Build INSERT batch
    BATCH = 100
    inserted = 0
    for i in range(0, len(nuove), BATCH):
        batch = nuove[i:i+BATCH]
        values = []
        for n in batch:
            new_id = str(uuid.uuid4())
            values.append(
                f"({sql_uuid(new_id)}, "
                f"{sql_str(n['cf_piva'])}, "
                f"{sql_str(n['cluster_norm'])}, "
                f"{sql_str(n['ragione_sociale']) if n['ragione_sociale'] else 'NULL'}, "
                f"{sql_str(n['nome_referente']) if n['nome_referente'] else 'NULL'}, "
                f"{sql_str(n['cellulare']) if n['cellulare'] else 'NULL'}, "
                f"{sql_str(n['provincia']) if n['provincia'] else 'NULL'}, "
                f"{sql_str(n['comune']) if n['comune'] else 'NULL'}, "
                f"{sql_str(n['via']) if n['via'] else 'NULL'}, "
                f"{sql_str(n['civico']) if n['civico'] else 'NULL'})"
            )
            lookups.anagrafica[n['cf_piva']] = new_id  # cache locale post-INSERT
        sql = (
            "INSERT INTO anagrafica (id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico) "
            "VALUES " + ", ".join(values) + " "
            "ON CONFLICT (cf_piva) DO NOTHING;"
        )
        db_exec(sql)
        inserted += len(batch)
        print(f"  batch {i//BATCH + 1}: inseriti {len(batch)}")

    return {'inserted': inserted}


# =====================================================================
# Module: contratti (vendita_pratiche + vendita_contratti)
# =====================================================================

def sanitize_segment(s, maxlen=60):
    """Pulisce stringa per uso in path Storage. Lowercase, alphanum + underscore."""
    if not s:
        return 'cliente'
    s = re.sub(r'[^\w\s]', '', s, flags=re.UNICODE)
    s = re.sub(r'\s+', '_', s.strip())
    s = re.sub(r'_+', '_', s).lower()
    return s[:maxlen] or 'cliente'


def yes_no_to_bool(s):
    """Converte 'Si'/'No' (case-insens) -> bool/None."""
    if not s:
        return None
    v = s.strip().lower()
    if v in ('si', 'sì', 'yes', 'true', 's'):
        return True
    if v in ('no', 'false', 'n'):
        return False
    return None


def module_contratti(lookups: Lookups, contratti_data: list, execute: bool):
    """Crea vendita_pratiche raggruppate per (anagrafica, data) + vendita_contratti."""
    print(f"\n=== Modulo: contratti ===")

    # Raggruppa per (cf_piva, data_giorno) -> pratica
    by_pratica = defaultdict(list)
    skipped_no_anag = 0
    skipped_no_cat = 0
    skipped_no_date = 0

    for c in contratti_data:
        if not c['data_contratto_iso']:
            skipped_no_date += 1
            continue
        anag_id = lookups.anagrafica.get(c['cf_piva']) if c['cf_piva'] else None
        if not anag_id:
            skipped_no_anag += 1
            continue
        cat_id = lookups.categoria_id(c['categoria_konahub'])
        if not cat_id:
            skipped_no_cat += 1
            continue

        c['_anagrafica_id'] = anag_id
        c['_categoria_id'] = cat_id
        c['_categoria_name'] = lookups.categoria_name_mirox(c['categoria_konahub'])
        # lookup offerta
        off_id, off_name = lookups.offerta_lookup(c['categoria_konahub'], c['offerta_konahub'], c['cluster_norm'])
        c['_offerta_id'] = off_id
        c['_offerta_snapshot'] = off_name
        # opzione
        opz_id, opz_name = lookups.opzione_lookup(c['opzione_konahub'])
        c['_opzione_id'] = opz_id
        c['_opzione_snapshot'] = opz_name
        # operatore
        c['_operatore_id'] = lookups.profilo_id(c['operatore_name'])

        # Chiave pratica: anagrafica + giorno
        day = c['data_contratto_iso'][:10]
        key = (anag_id, day)
        by_pratica[key].append(c)

    print(f"  Contratti utili: {sum(len(v) for v in by_pratica.values())}")
    print(f"  Pratiche risultanti: {len(by_pratica)}")
    print(f"  Skippati (no anagrafica): {skipped_no_anag}")
    print(f"  Skippati (no categoria): {skipped_no_cat}")
    print(f"  Skippati (no data): {skipped_no_date}")

    # Stats
    cnt_off_null = sum(1 for c in contratti_data if c.get('_offerta_id') is None and c.get('_anagrafica_id'))
    cnt_op_null = sum(1 for c in contratti_data if c.get('_operatore_id') is None and c.get('_anagrafica_id'))
    print(f"  Contratti con offerta non trovata (NULL): {cnt_off_null}")
    print(f"  Contratti con operatore=NULL (Cerea/vuoto): {cnt_op_null}")

    if not execute:
        print(f"  [DRY-RUN] Niente inserito")
        # Sample 3 pratiche
        sample = list(by_pratica.items())[:3]
        for (anag_id, day), contracts in sample:
            print(f"    Pratica anag={anag_id[:8]} giorno={day} contratti={len(contracts)}")
            for c in contracts:
                print(f"      cat={c['categoria_konahub']} off={c['offerta_konahub'][:30]} off_id={'OK' if c['_offerta_id'] else 'NULL'}")
        return {'pratiche': len(by_pratica), 'contratti': sum(len(v) for v in by_pratica.values())}

    # Execute: per ogni pratica, INSERT vendita_pratiche poi vendita_contratti
    pratiche_inserted = 0
    contratti_inserted = 0
    BATCH_PRATICHE = 50

    pratica_groups = list(by_pratica.items())
    for batch_start in range(0, len(pratica_groups), BATCH_PRATICHE):
        batch = pratica_groups[batch_start:batch_start+BATCH_PRATICHE]
        # Genera UUID pratiche
        pratiche_rows = []
        contratti_rows = []
        for (anag_id, day), contracts in batch:
            pratica_id = str(uuid.uuid4())
            ragsoc = contracts[0]['ragione_sociale'] or 'cliente'
            ragsoc_safe = sanitize_segment(ragsoc)
            d = datetime.strptime(day, '%Y-%m-%d')
            d_str = d.strftime('%d_%m_%Y')
            cartella = f"Contratto_{ragsoc_safe}_{d_str}_{pratica_id[:6]}"
            data_pratica = contracts[0]['data_contratto_iso']
            operatore_id = contracts[0]['_operatore_id']

            pratiche_rows.append((pratica_id, anag_id, operatore_id, data_pratica, cartella))

            for c in contracts:
                contratto_id = str(uuid.uuid4())
                contratti_rows.append((contratto_id, pratica_id, c))

        # INSERT pratiche batch
        prat_values = []
        for (pid, anid, opid, dt, cart) in pratiche_rows:
            prat_values.append(
                f"({sql_uuid(pid)}, {sql_uuid(anid)}, {sql_uuid(opid)}, {sql_str(dt)}, "
                f"'spontaneo', 'inviata', {sql_str(cart)}, '2026/01')"
            )
        sql = (
            "INSERT INTO vendita_pratiche (id, anagrafica_id, operatore_id, data_pratica, "
            "origine_pratica, stato_pratica, nome_cartella_storage, storage_base_path) VALUES "
            + ', '.join(prat_values) + ';'
        )
        db_exec(sql, timeout=180)
        pratiche_inserted += len(pratiche_rows)

        # INSERT contratti batch (split a 100 per limite SQL)
        BATCH_C = 100
        for ci_start in range(0, len(contratti_rows), BATCH_C):
            sub = contratti_rows[ci_start:ci_start+BATCH_C]
            cv = []
            for (cid, pid, c) in sub:
                cv.append(
                    "(" + ", ".join([
                        sql_uuid(cid),
                        sql_uuid(pid),
                        sql_uuid(c['_anagrafica_id']),
                        sql_uuid(c['_operatore_id']),
                        sql_str(c['data_contratto_iso']),
                        sql_str(c['cluster_norm']),
                        sql_uuid(c['_categoria_id']),
                        sql_uuid(c['_offerta_id']),
                        sql_uuid(c['_opzione_id']),
                        sql_str(c['_categoria_name']) if c['_categoria_name'] else 'NULL',
                        sql_str(c['_offerta_snapshot']) if c['_offerta_snapshot'] else 'NULL',
                        sql_str(c['_opzione_snapshot']) if c['_opzione_snapshot'] else 'NULL',
                        sql_num(c['punteggio_offerta'] or 0),
                        sql_num(c['punteggio_opzione'] or 0),
                        sql_str(c['tipo_attivazione']) if c['tipo_attivazione'] else 'NULL',
                        sql_str(c['apri_chiudi']) if c['apri_chiudi'] else 'NULL',
                        sql_str(c['intestatario']) if c['intestatario'] else 'NULL',
                        sql_str(c['switch_sim']) if c['switch_sim'] else 'NULL',
                        sql_str(c['modalita_pagamento']) if c['modalita_pagamento'] else 'NULL',
                        sql_bool(yes_no_to_bool(c['dispositivo']) or False),
                        sql_str(c['imei']) if c['imei'] else 'NULL',
                        sql_str(c['fascia_prezzo']) if c['fascia_prezzo'] else 'NULL',
                        sql_str(c['tipo_acquisto']) if c['tipo_acquisto'] else 'NULL',
                        sql_str(c['finanziaria']) if c['finanziaria'] else 'NULL',
                        sql_bool(yes_no_to_bool(c['kolme'])),
                        "'controllato'",  # stato_controllo
                        'FALSE',  # reload_exchange
                        'FALSE',  # reload_forever
                        "'inserimento'",  # stato_inserimento
                    ]) + ")"
                )
            sql = (
                "INSERT INTO vendita_contratti (id, pratica_id, anagrafica_id, operatore_id, data_contratto, "
                "cluster_cliente, categoria_id, offerta_id, opzione_id, categoria_snapshot, nome_offerta_snapshot, "
                "nome_opzione_snapshot, punteggio_gara_offerta, punteggio_gara_opzione, tipo_attivazione, "
                "apri_chiudi, intestatario, switch_sim, modalita_pagamento, dispositivo_associato, imei, "
                "fascia_prezzo, tipo_acquisto, finanziaria, kolme, stato_controllo, reload_exchange, "
                "reload_forever, stato_inserimento) VALUES "
                + ', '.join(cv) + ';'
            )
            db_exec(sql, timeout=180)
            contratti_inserted += len(sub)

        print(f"  batch {batch_start//BATCH_PRATICHE + 1}/{(len(pratica_groups)+BATCH_PRATICHE-1)//BATCH_PRATICHE}: "
              f"pratiche {len(pratiche_rows)}, contratti {sum(1 for _ in contratti_rows)}")

    return {'pratiche': pratiche_inserted, 'contratti': contratti_inserted}


# =====================================================================
# Module: switch_sim
# =====================================================================

def normalize_date_only(s):
    """Solo data YYYY-MM-DD (no time)."""
    iso = normalize_date(s)
    return iso[:10] if iso else None


def parse_importo(s):
    """'€ 20.00' -> 20.0"""
    if not s:
        return None
    s = re.sub(r'[^\d.,]', '', s).replace(',', '.')
    try:
        return float(s) if s else None
    except ValueError:
        return None


def module_switch_sim(lookups, execute):
    print(f"\n=== Modulo: switch_sim ===")
    path = CSV_DIR / 'switch.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    records = []
    skipped_pre = 0
    for r in data:
        # Match by header index instead of name for clarity
        di_raw = r[col['Data Inserimento Richiesta']]
        di = normalize_date(di_raw)
        if not di or not is_2026_or_later(di):
            skipped_pre += 1
            continue
        op_name = normalize_operatore_name(r[col['Operatore']])
        cf_att = normalize_cf_piva(r[col['C.F./P.IVA Attuale Intestatario']])
        cf_rie = normalize_cf_piva(r[col['C.F./P.IVA Rientro SIM']])
        records.append({
            'stato': r[col['Stato']].strip() or 'IN CORSO',
            'data_inserimento': di,
            'operatore_id': lookups.profilo_id(op_name),
            'operatore_nome': op_name,
            'gestore': r[col['Gestore']].strip(),
            'ragione_sociale_attuale': r[col['Ragione Sociale Attuale Intestatario']].strip(),
            'cf_piva_attuale': cf_att,
            'ragione_sociale_rientro': r[col['Ragione Sociale Rientro SIM']].strip(),
            'cf_piva_rientro': cf_rie,
            'anagrafica_attuale_id': lookups.anagrafica.get(cf_att) if cf_att else None,
            'anagrafica_rientro_id': lookups.anagrafica.get(cf_rie) if cf_rie else None,
            'numero_portabilita': r[col['Numero portabilità']].strip(),
            'iccid_sim': r[col['ICCID SIM']].strip(),
            'numero_provvisorio': r[col['Numero Provvisorio']].strip(),
            'giorno_attivazione': normalize_date_only(r[col['Giorno Attivazione']]),
            'giorno_portabilita': normalize_date_only(r[col['Giorno Portabilità']]),
            'giorno_rientro': normalize_date_only(r[col['Giorno Rientro']]),
            'prima_ricarica_giorno_pianificato': normalize_date_only(r[col['1° Ricarica']]),
            'seconda_ricarica_giorno_pianificato': normalize_date_only(r[col['2° Ricarica']]),
            'sim_definitiva_rientro': r[col['Sim definitiva di rientro']].strip(),
            'offerta_rientro': r[col['Offerta di Rientro']].strip(),
            'modalita_pagamento': r[col['Modalità Pagamento']].strip(),
            'importo': parse_importo(r[col['Importo']]),
            'note': r[col['Note']].strip(),
            'prima_ricarica_data_esecuzione': normalize_date_only(r[col['Data Esecuzione 1° ricarica']] if 'Data Esecuzione 1° ricarica' in col else ''),
            'prima_ricarica_importo': parse_importo(r[col['Importo']]) if False else None,  # ambiguous, skip
            'seconda_ricarica_data_esecuzione': normalize_date_only(r[col['Data Esecuzione 2° ricarica']] if 'Data Esecuzione 2° ricarica' in col else ''),
        })
    print(f"  Righe 2026: {len(records)}, skippate pre-2026: {skipped_pre}")

    if not execute:
        for r in records[:3]:
            print(f"    stato={r['stato']} ragsoc={r['ragione_sociale_attuale'][:30]} data={r['data_inserimento'][:10]}")
        return {'count': len(records), 'inserted': 0}

    values = []
    for r in records:
        values.append(
            "(" + ", ".join([
                sql_str(r['stato']),
                sql_str(r['data_inserimento']),
                sql_uuid(r['operatore_id']),
                sql_str(r['operatore_nome']) if r['operatore_nome'] else 'NULL',
                sql_str(r['gestore']) if r['gestore'] else 'NULL',
                sql_str(r['ragione_sociale_attuale']) if r['ragione_sociale_attuale'] else 'NULL',
                sql_str(r['cf_piva_attuale']) if r['cf_piva_attuale'] else 'NULL',
                sql_str(r['ragione_sociale_rientro']) if r['ragione_sociale_rientro'] else 'NULL',
                sql_str(r['cf_piva_rientro']) if r['cf_piva_rientro'] else 'NULL',
                sql_uuid(r['anagrafica_attuale_id']),
                sql_uuid(r['anagrafica_rientro_id']),
                sql_str(r['numero_portabilita']) if r['numero_portabilita'] else 'NULL',
                sql_str(r['iccid_sim']) if r['iccid_sim'] else 'NULL',
                sql_str(r['numero_provvisorio']) if r['numero_provvisorio'] else 'NULL',
                sql_str(r['giorno_attivazione']) if r['giorno_attivazione'] else 'NULL',
                sql_str(r['giorno_portabilita']) if r['giorno_portabilita'] else 'NULL',
                sql_str(r['giorno_rientro']) if r['giorno_rientro'] else 'NULL',
                sql_str(r['prima_ricarica_giorno_pianificato']) if r['prima_ricarica_giorno_pianificato'] else 'NULL',
                sql_str(r['seconda_ricarica_giorno_pianificato']) if r['seconda_ricarica_giorno_pianificato'] else 'NULL',
                sql_str(r['sim_definitiva_rientro']) if r['sim_definitiva_rientro'] else 'NULL',
                sql_str(r['offerta_rientro']) if r['offerta_rientro'] else 'NULL',
                sql_str(r['modalita_pagamento']) if r['modalita_pagamento'] else 'NULL',
                sql_num(r['importo']),
                sql_str(r['note']) if r['note'] else 'NULL',
                sql_str(r['prima_ricarica_data_esecuzione']) if r['prima_ricarica_data_esecuzione'] else 'NULL',
                sql_str(r['seconda_ricarica_data_esecuzione']) if r['seconda_ricarica_data_esecuzione'] else 'NULL',
            ]) + ")"
        )
    sql = (
        "INSERT INTO vendita_switch_sim (stato, data_inserimento, operatore_id, operatore_nome, gestore, "
        "ragione_sociale_attuale, cf_piva_attuale, ragione_sociale_rientro, cf_piva_rientro, "
        "anagrafica_attuale_id, anagrafica_rientro_id, numero_portabilita, iccid_sim, numero_provvisorio, "
        "giorno_attivazione, giorno_portabilita, giorno_rientro, prima_ricarica_giorno_pianificato, "
        "seconda_ricarica_giorno_pianificato, sim_definitiva_rientro, offerta_rientro, modalita_pagamento, "
        "importo, note, prima_ricarica_data_esecuzione, seconda_ricarica_data_esecuzione) VALUES "
        + ', '.join(values) + ';'
    )
    db_exec(sql)
    return {'count': len(records), 'inserted': len(records)}


# =====================================================================
# Module: apri_chiudi
# =====================================================================

def module_apri_chiudi(lookups, execute):
    print(f"\n=== Modulo: apri_chiudi ===")
    path = CSV_DIR / 'apri_chiudi.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    records = []
    skipped = 0
    for r in data:
        di = normalize_date(r[col['Data Inserimento']])
        if not di or not is_2026_or_later(di):
            skipped += 1
            continue
        op_name = normalize_operatore_name(r[col['Operatore']])
        cf_v = normalize_cf_piva(r[col['CF/P.IVA - Vecchio']])
        cf_n = normalize_cf_piva(r[col['CF/P.IVA - Nuovo']])
        records.append({
            'data_inserimento': di,
            'operatore_id': lookups.profilo_id(op_name),
            'operatore_nome': op_name,
            'stato': r[col['Stato']].strip() or 'IN CORSO',
            'cluster_vecchio': r[col['Cluster - Vecchio']].strip(),
            'ragione_sociale_vecchio': r[col['Ragione Sociale - Vecchio']].strip(),
            'cf_piva_vecchio': cf_v,
            'anagrafica_vecchio_id': lookups.anagrafica.get(cf_v) if cf_v else None,
            'cluster_nuovo': r[col['Cluster -  Nuovo']].strip(),
            'ragione_sociale_nuovo': r[col['Ragione Sociale -  Nuovo']].strip(),
            'cf_piva_nuovo': cf_n,
            'anagrafica_nuovo_id': lookups.anagrafica.get(cf_n) if cf_n else None,
            'sim_disattivare': (r[col['Sim Disattivare']].strip() or '').upper() or None,
            'numero_sim': r[col['Numero Sim']].strip(),
            'chiusura_linea': (r[col['Chiusura Linea']].strip() or '').upper() or None,
            'note': r[col['Note']].strip(),
            'data_invio_disdetta': normalize_date_only(r[col['Data Invio Disdetta']]),
            'numero_ask': r[col['Numero ASK']].strip(),
        })
    print(f"  Righe 2026: {len(records)}, skippate: {skipped}")

    if not execute:
        return {'count': len(records), 'inserted': 0}

    values = []
    for r in records:
        values.append(
            "(" + ", ".join([
                sql_str(r['data_inserimento']),
                sql_uuid(r['operatore_id']),
                sql_str(r['operatore_nome']) if r['operatore_nome'] else 'NULL',
                sql_str(r['stato']),
                sql_str(r['cluster_vecchio']) if r['cluster_vecchio'] else 'NULL',
                sql_str(r['ragione_sociale_vecchio']) if r['ragione_sociale_vecchio'] else 'NULL',
                sql_str(r['cf_piva_vecchio']) if r['cf_piva_vecchio'] else 'NULL',
                sql_uuid(r['anagrafica_vecchio_id']),
                sql_str(r['cluster_nuovo']) if r['cluster_nuovo'] else 'NULL',
                sql_str(r['ragione_sociale_nuovo']) if r['ragione_sociale_nuovo'] else 'NULL',
                sql_str(r['cf_piva_nuovo']) if r['cf_piva_nuovo'] else 'NULL',
                sql_uuid(r['anagrafica_nuovo_id']),
                sql_str(r['sim_disattivare']) if r['sim_disattivare'] else 'NULL',
                sql_str(r['numero_sim']) if r['numero_sim'] else 'NULL',
                sql_str(r['chiusura_linea']) if r['chiusura_linea'] else 'NULL',
                sql_str(r['note']) if r['note'] else 'NULL',
                sql_str(r['data_invio_disdetta']) if r['data_invio_disdetta'] else 'NULL',
                sql_str(r['numero_ask']) if r['numero_ask'] else 'NULL',
            ]) + ")"
        )
    sql = (
        "INSERT INTO vendita_apri_chiudi (data_inserimento, operatore_id, operatore_nome, stato, "
        "cluster_vecchio, ragione_sociale_vecchio, cf_piva_vecchio, anagrafica_vecchio_id, "
        "cluster_nuovo, ragione_sociale_nuovo, cf_piva_nuovo, anagrafica_nuovo_id, "
        "sim_disattivare, numero_sim, chiusura_linea, note, data_invio_disdetta, numero_ask) VALUES "
        + ', '.join(values) + ';'
    )
    db_exec(sql)
    return {'count': len(records), 'inserted': len(records)}


# =====================================================================
# Module: comodato
# =====================================================================

def module_comodato(lookups, execute):
    print(f"\n=== Modulo: comodato ===")
    path = CSV_DIR / 'comodato.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    records = []
    skipped = 0
    for r in data:
        du = normalize_date_only(r[col['Data Uscita']])
        if not du or du < '2026-01-01':
            skipped += 1
            continue
        cf = normalize_cf_piva(r[col['Codice Fiscale']])
        records.append({
            'codice': r[col['ID']].strip(),
            'nome': r[col['Nome']].strip(),
            'cognome': r[col['Cognome']].strip(),
            'codice_fiscale': cf,
            'anagrafica_id': lookups.anagrafica.get(cf) if cf else None,
            'telefono': r[col['Telefono']].strip(),
            'imei': r[col['IMEI']].strip() or 'UNKNOWN',
            'sim_temporanea': r[col['SIM Temporanea']].strip(),
            'data_uscita': du,
            'data_rientro': normalize_date_only(r[col['Data Rientro']]),
            'stato': 'fuori' if r[col['Stato']].strip().lower() == 'fuori' else 'rientrato',
        })
    print(f"  Righe 2026: {len(records)}, skippate: {skipped}")

    if not execute:
        return {'count': len(records), 'inserted': 0}

    values = []
    for r in records:
        values.append(
            "(" + ", ".join([
                sql_str(r['codice']),
                sql_str(r['nome']),
                sql_str(r['cognome']),
                sql_str(r['codice_fiscale']) if r['codice_fiscale'] else 'NULL',
                sql_uuid(r['anagrafica_id']),
                sql_str(r['telefono']) if r['telefono'] else 'NULL',
                sql_str(r['imei']),
                sql_str(r['sim_temporanea']) if r['sim_temporanea'] else 'NULL',
                sql_str(r['data_uscita']),
                sql_str(r['data_rientro']) if r['data_rientro'] else 'NULL',
                sql_str(r['stato']),
            ]) + ")"
        )
    sql = (
        "INSERT INTO post_vendita_dispositivi_comodato (codice, nome, cognome, codice_fiscale, "
        "anagrafica_id, telefono, imei, sim_temporanea, data_uscita, data_rientro, stato) VALUES "
        + ', '.join(values) + ';'
    )
    db_exec(sql)
    return {'count': len(records), 'inserted': len(records)}


# =====================================================================
# Module: ordini smartphone
# =====================================================================

def module_ordini(lookups, execute):
    print(f"\n=== Modulo: ordini smartphone ===")
    path = CSV_DIR / 'ordini_device.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    STATO_MAP = {
        'Venduto': 'Venduto',
        'Annullato': 'Annullato',
        'In Attesa di Ordine': 'In attesa',
        'In attesa': 'In attesa',
        'Ordinato': 'Ordinato',
        'Arrivato': 'Arrivato',
    }

    records = []
    skipped = 0
    for r in data:
        dr_raw = r[col['Data Registrazione']]
        dr = normalize_date(dr_raw)
        if not dr or not is_2026_or_later(dr):
            skipped += 1
            continue
        op_name = normalize_operatore_name(r[col['Operatore']])
        records.append({
            'data_registrazione': dr,
            'operatore_id': lookups.profilo_id(op_name),
            'operatore_nome': op_name,
            'nome_cognome': r[col['Nome e Cognome']].strip() or 'sconosciuto',
            'numero_cellulare': r[col['Numero Cellulare']].strip(),
            'marca': r[col['Marca']].strip(),
            'modello': r[col['Modello']].strip(),
            'memoria': r[col['Memoria']].strip(),
            'colorazione': r[col['Colorazione']].strip(),
            'note': r[col['Note']].strip(),
            'stato': STATO_MAP.get(r[col['Stato']].strip(), r[col['Stato']].strip() or 'In Attesa di Ordine'),
        })
    print(f"  Righe 2026: {len(records)}, skippate: {skipped}")

    if not execute:
        return {'count': len(records), 'inserted': 0}

    values = []
    for r in records:
        values.append(
            "(" + ", ".join([
                sql_str(r['data_registrazione']),
                sql_uuid(r['operatore_id']),
                sql_str(r['operatore_nome']) if r['operatore_nome'] else 'NULL',
                sql_str(r['nome_cognome']),
                sql_str(r['numero_cellulare']) if r['numero_cellulare'] else 'NULL',
                sql_str(r['marca']) if r['marca'] else 'NULL',
                sql_str(r['modello']) if r['modello'] else 'NULL',
                sql_str(r['memoria']) if r['memoria'] else 'NULL',
                sql_str(r['colorazione']) if r['colorazione'] else 'NULL',
                sql_str(r['note']) if r['note'] else 'NULL',
                sql_str(r['stato']),
            ]) + ")"
        )
    sql = (
        "INSERT INTO vendita_ordini_smartphone (data_registrazione, operatore_id, operatore_nome, "
        "nome_cognome, numero_cellulare, marca, modello, memoria, colorazione, note, stato) VALUES "
        + ', '.join(values) + ';'
    )
    db_exec(sql)
    return {'count': len(records), 'inserted': len(records)}


# =====================================================================
# Module: protecta
# =====================================================================

TEST_CLIENTI = {'test', 'matteo', 'mi', 'michele', 'mattteo', 'roncoletta'}


def module_protecta(lookups, execute):
    print(f"\n=== Modulo: protecta ===")
    path = CSV_DIR / 'protecta.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    records = []
    skipped_test = 0
    skipped_date = 0
    for r in data:
        d = normalize_date(r[col['Data/ora Preventivo']])
        if not d or not is_2026_or_later(d):
            skipped_date += 1
            continue
        cliente = r[col['Cliente']].strip()
        if not cliente or cliente.lower() in TEST_CLIENTI:
            skipped_test += 1
            continue
        op_name = normalize_operatore_name(r[col['Operatore']])
        cell = r[col['Numero Cellulare']].strip()
        # Skip se numero ovviamente fake (es. tutte cifre 3)
        if re.fullmatch(r'3+', cell or '') or re.fullmatch(r'test', cell or '', re.I):
            skipped_test += 1
            continue
        records.append({
            'data_preventivo': d,
            'operatore_id': lookups.profilo_id(op_name),
            'operatore_nome': op_name,
            'cliente': cliente,
            'numero_cellulare': cell,
            'kit': r[col['Kit']].strip() or 'Kit Casa',
            'stato': r[col['Stato']].strip() or 'In corso',
        })
    print(f"  Righe 2026 utili: {len(records)}, skippate test: {skipped_test}, skippate per data: {skipped_date}")

    if not execute:
        return {'count': len(records), 'inserted': 0}

    values = []
    for r in records:
        values.append(
            "(" + ", ".join([
                sql_str(r['data_preventivo']),
                sql_uuid(r['operatore_id']),
                sql_str(r['operatore_nome']) if r['operatore_nome'] else 'NULL',
                sql_str(r['cliente']),
                sql_str(r['numero_cellulare']) if r['numero_cellulare'] else 'NULL',
                sql_str(r['kit']),
                sql_str(r['stato']),
            ]) + ")"
        )
    sql = (
        "INSERT INTO vendita_simulatore_protecta (data_preventivo, operatore_id, operatore_nome, "
        "cliente, numero_cellulare, kit, stato) VALUES "
        + ', '.join(values) + ';'
    )
    db_exec(sql)
    return {'count': len(records), 'inserted': len(records)}


# =====================================================================
# Module: ticket
# =====================================================================

def module_ticket(lookups, execute):
    print(f"\n=== Modulo: ticket ===")
    path = CSV_DIR / 'ticket.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    records = []
    skipped = 0
    for r in data:
        dc = normalize_date(r[col['Data Creazione']])
        if not dc or not is_2026_or_later(dc):
            skipped += 1
            continue
        op_raw = r[col['Con Chi']].strip()
        op_name = normalize_operatore_name(op_raw)
        records.append({
            'data_creazione': dc,
            'intestatario': r[col['Nome Cognome']].strip() or 'cliente',
            'cellulare': r[col['Cellulare']].strip() or '-',
            'con_chi': op_raw or 'Mirko',
            'motivazione': r[col['Motivazione']].strip() or '-',
            'stato': r[col['Stato']].strip() or 'Da gestire',
            'nota_lavorazione': r[col['Nota Lavorazione']].strip(),
            'data_lavorazione': normalize_date(r[col['Data Lavorazione']]),
            'operatore_id': lookups.profilo_id(op_name),
            'operatore_nome': op_name,
        })
    print(f"  Righe 2026: {len(records)}, skippate: {skipped}")

    if not execute:
        return {'count': len(records), 'inserted': 0}

    values = []
    for r in records:
        values.append(
            "(" + ", ".join([
                sql_str(r['data_creazione']),
                sql_str(r['intestatario']),
                sql_str(r['cellulare']),
                sql_str(r['con_chi']),
                sql_str(r['motivazione']),
                sql_str(r['stato']),
                sql_str(r['nota_lavorazione']) if r['nota_lavorazione'] else 'NULL',
                sql_str(r['data_lavorazione']) if r['data_lavorazione'] else 'NULL',
                sql_uuid(r['operatore_id']),
                sql_str(r['operatore_nome']) if r['operatore_nome'] else 'NULL',
            ]) + ")"
        )
    # Batch da 100
    BATCH = 100
    inserted = 0
    for i in range(0, len(values), BATCH):
        sub = values[i:i+BATCH]
        sql = (
            "INSERT INTO ticket (data_creazione, intestatario, cellulare, con_chi, motivazione, stato, "
            "nota_lavorazione, data_lavorazione, operatore_id, operatore_nome) VALUES "
            + ', '.join(sub) + ';'
        )
        db_exec(sql)
        inserted += len(sub)
    return {'count': len(records), 'inserted': inserted}


# =====================================================================
# Module: segnalazioni (importo TUTTE, dedupe per id konahub)
# =====================================================================

def module_segnalazioni(lookups, execute):
    print(f"\n=== Modulo: segnalazioni ===")
    path = CSV_DIR / 'segnalazioni.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    # Dedupe vs DB existing
    existing = set()
    try:
        r = db_query("SELECT id FROM segnalazioni;")
        for row in r.get('rows', []):
            existing.add(int(row['id']))
    except Exception as e:
        print(f"  WARN reading segnalazioni existing: {e}")

    records = []
    skipped_dup = 0
    for r in data:
        try:
            sid = int(r[col['ID Segnalazione']])
        except (ValueError, KeyError):
            continue
        if sid in existing:
            skipped_dup += 1
            continue
        # Costruisce nome+cognome -> ragione_sociale
        nome = r[col['Nome']].strip()
        cognome = r[col['Cognome']].strip()
        ragsoc = f"{nome} {cognome}".strip() or 'cliente'
        cf = normalize_cf_piva(r[col['Codice Fiscale']])
        records.append({
            'id': sid,
            'stato': r[col['Stato']].strip() or 'Chiuso',
            'urgenza': r[col['Urgenza']].strip(),
            'operatore': r[col['Operatore']].strip(),
            'numero_contatto': r[col['Numero Contatto']].strip(),
            'gestione_pratica': r[col['Gestione Pratica']].strip(),
            'dettagli_segnalazione': r[col['Dettagli Segnalazione']].strip(),
            'link_cartella_drive': r[col['Link Cartella Drive']].strip(),
            'data_invio_richiesta': normalize_date(r[col['Data Invio Richiesta']]),
            'data_apertura_segnalazione': normalize_date(r[col['Data Apertura Segnalazione']]),
            'azione_eseguita': r[col['Azione Eseguita']].strip(),
            'tipo_ask': r[col['Tipo ASK']].strip(),
            'numero_ask': r[col['Numero ASK']].strip(),
            'note_back_office': r[col['Note Back Office']].strip(),
            'storico_chat': r[col['Storico Chat']].strip(),
            'data_ultima_modifica': normalize_date(r[col['Data Ultima Modifica']]),
            'data_chiusura': normalize_date(r[col['Data Chiusura']]),
            'ragione_sociale': ragsoc,
            'codice_fiscale_piva': cf,
        })
    print(f"  Righe da importare: {len(records)}, duplicati DB skipped: {skipped_dup}")

    if not execute:
        return {'count': len(records), 'inserted': 0}

    # Batch da 100
    BATCH = 100
    inserted = 0
    for i in range(0, len(records), BATCH):
        sub = records[i:i+BATCH]
        values = []
        for r in sub:
            values.append(
                "(" + ", ".join([
                    str(r['id']),
                    sql_str(r['stato']),
                    sql_str(r['urgenza']) if r['urgenza'] else 'NULL',
                    sql_str(r['operatore']) if r['operatore'] else 'NULL',
                    sql_str(r['numero_contatto']) if r['numero_contatto'] else 'NULL',
                    sql_str(r['gestione_pratica']) if r['gestione_pratica'] else 'NULL',
                    sql_str(r['dettagli_segnalazione']) if r['dettagli_segnalazione'] else 'NULL',
                    sql_str(r['link_cartella_drive']) if r['link_cartella_drive'] else 'NULL',
                    sql_str(r['data_invio_richiesta']) if r['data_invio_richiesta'] else 'NULL',
                    sql_str(r['data_apertura_segnalazione']) if r['data_apertura_segnalazione'] else 'NULL',
                    sql_str(r['azione_eseguita']) if r['azione_eseguita'] else 'NULL',
                    sql_str(r['tipo_ask']) if r['tipo_ask'] else 'NULL',
                    sql_str(r['numero_ask']) if r['numero_ask'] else 'NULL',
                    sql_str(r['note_back_office']) if r['note_back_office'] else 'NULL',
                    "'[]'::jsonb" if not r['storico_chat'] else f"jsonb_build_array(jsonb_build_object('message', {sql_str(r['storico_chat'][:1000])}))",
                    sql_str(r['data_ultima_modifica']) if r['data_ultima_modifica'] else 'NULL',
                    sql_str(r['data_chiusura']) if r['data_chiusura'] else 'NULL',
                    sql_str(r['ragione_sociale']),
                    sql_str(r['codice_fiscale_piva']) if r['codice_fiscale_piva'] else 'NULL',
                ]) + ")"
            )
        sql = (
            "INSERT INTO segnalazioni (id, stato, urgenza, operatore, numero_contatto, gestione_pratica, "
            "dettagli_segnalazione, link_cartella_drive, data_invio_richiesta, data_apertura_segnalazione, "
            "azione_eseguita, tipo_ask, numero_ask, note_back_office, storico_chat, "
            "data_ultima_modifica, data_chiusura, ragione_sociale, codice_fiscale_piva) VALUES "
            + ', '.join(values) + " ON CONFLICT (id) DO NOTHING;"
        )
        db_exec(sql)
        inserted += len(sub)
    return {'count': len(records), 'inserted': inserted}


# =====================================================================
# Module: check_fisso (UPDATE post_vendita_controllo_fissi)
# =====================================================================

TECNOLOGIA_MAP = {
    'FTTC VULA': 'FTTC',
    'FTTC': 'FTTC',
    'FTTH_OS': 'FTTH_OF',
    'FTTH_OF': 'FTTH_OF',
    'FTTH_FWCOP': 'FTTH_FWCOP',
    'FWA OUT': 'FWA OUT',
    'FWA IN': 'FWA IN',
    'FWA VOCE': 'FWA VOCE',
    'ADSL ULL': 'FTTC',  # fallback per ADSL legacy
    'ADSL': 'FTTC',
}

STATO_FISSO_MAP = {
    'Attivato': 'Attivo',
    'ATTIVO': 'Attivo',
    'Attivo': 'Attivo',
    'KO': 'KO',
    'Ko': 'KO',
    'IN ATTIVAZIONE': 'In Attivazione',
    'In Attivazione': 'In Attivazione',
    'Da completare': 'Da completare',
}


def module_check_fisso(lookups, execute):
    print(f"\n=== Modulo: check_fisso ===")
    path = CSV_DIR / 'check_fisso.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    # Pre-fetch contratti Fisso del 2026 con post_vendita_controllo_fissi.id + anag + data
    fissi_query = """
        SELECT pvcf.id AS pvcf_id, pvcf.contratto_id, vc.anagrafica_id, a.cf_piva, vc.data_contratto::date AS day
        FROM post_vendita_controllo_fissi pvcf
        JOIN vendita_contratti vc ON vc.id = pvcf.contratto_id
        JOIN anagrafica a ON a.id = vc.anagrafica_id;
    """
    r = db_query(fissi_query)
    by_cf_date = defaultdict(list)
    for row in r.get('rows', []):
        cf_norm = (row['cf_piva'] or '').strip().upper()
        by_cf_date[cf_norm].append(row)

    records_2026 = 0
    matched = 0
    unmatched = []
    updates = []  # (pvcf_id, fields_dict)
    for r in data:
        da_raw = r[col['DATA ACQUISIZIONE']]
        da = normalize_date_only(da_raw)
        if not da or da < '2026-01-01':
            continue
        records_2026 += 1
        # check_fisso usa 'C.F./P.IVA', check_lg usa 'C.F. o P.IVA'
        cf_col = 'C.F./P.IVA' if 'C.F./P.IVA' in col else 'C.F. o P.IVA'
        cf = normalize_cf_piva(r[col[cf_col]])
        cands = by_cf_date.get(cf, [])
        if not cands:
            unmatched.append(cf)
            continue
        # Best match: data piu' vicina
        target = datetime.strptime(da, '%Y-%m-%d').date()
        best = min(cands, key=lambda x: abs((datetime.strptime(x['day'], '%Y-%m-%d').date() - target).days) if x['day'] else 365)
        matched += 1
        # Costruisce update
        fields = {
            'codice_cliente': r[col['CODICE CLIENTE']].strip() if 'CODICE CLIENTE' in col else None,
            'tecnologia': TECNOLOGIA_MAP.get(r[col['TECNOLOGIA']].strip()),
            'cod_contratto': r[col['COD. CONTRATTO']].strip(),
            'cod_pos': r[col['CODICE POS']].strip() if 'CODICE POS' in col else None,
            'numero_fisso': r[col['NUMERO FISSO']].strip(),
            'attivazione_prevista': normalize_date_only(r[col['ATTIVAZIONE PREVISTA']]) if 'ATTIVAZIONE PREVISTA' in col else None,
            'data_attivazione': normalize_date_only(r[col['DATA ATTIVAZIONE']]),
            'stato': STATO_FISSO_MAP.get(r[col['STATO ATTIVAZIONE']].strip(), 'Da completare'),
            'motivo_ko': r[col['NOTE']].strip() if 'NOTE' in col else None,
        }
        updates.append((best['pvcf_id'], fields))

    print(f"  Righe 2026: {records_2026}, matched: {matched}, unmatched: {len(unmatched)}")
    if unmatched[:5]:
        print(f"  Sample unmatched CF: {unmatched[:5]}")

    if not execute:
        return {'count': records_2026, 'matched': matched, 'updated': 0}

    # Batch UPDATE via VALUES+JOIN per essere veloce
    fields_keys = ['codice_cliente', 'tecnologia', 'cod_contratto', 'cod_pos', 'numero_fisso', 'attivazione_prevista', 'data_attivazione', 'stato', 'motivo_ko']
    rows_sql = []
    for (pvcf_id, fields) in updates:
        vals = [sql_uuid(pvcf_id)]
        for k in fields_keys:
            v = fields.get(k)
            if v is None:
                vals.append('NULL')
            elif k in ('attivazione_prevista', 'data_attivazione'):
                vals.append(sql_str(v) + '::date')
            else:
                vals.append(sql_str(v))
        rows_sql.append('(' + ', '.join(vals) + ')')
    if not rows_sql:
        return {'count': records_2026, 'matched': matched, 'updated': 0}
    sql = (
        "UPDATE post_vendita_controllo_fissi pvcf SET "
        + ', '.join([
            "codice_cliente = COALESCE(v.codice_cliente, pvcf.codice_cliente)",
            "tecnologia = COALESCE(v.tecnologia, pvcf.tecnologia)",
            "cod_contratto = COALESCE(v.cod_contratto, pvcf.cod_contratto)",
            "cod_pos = COALESCE(v.cod_pos, pvcf.cod_pos)",
            "numero_fisso = COALESCE(v.numero_fisso, pvcf.numero_fisso)",
            "attivazione_prevista = COALESCE(v.attivazione_prevista, pvcf.attivazione_prevista)",
            "data_attivazione = COALESCE(v.data_attivazione, pvcf.data_attivazione)",
            "stato = COALESCE(v.stato, pvcf.stato)",
            "motivo_ko = COALESCE(v.motivo_ko, pvcf.motivo_ko)",
            "updated_at = NOW()",
        ])
        + " FROM (VALUES " + ', '.join(rows_sql)
        + ") AS v(id, codice_cliente, tecnologia, cod_contratto, cod_pos, numero_fisso, attivazione_prevista, data_attivazione, stato, motivo_ko) "
        + "WHERE pvcf.id = v.id::uuid;"
    )
    db_exec(sql, timeout=300)
    return {'count': records_2026, 'matched': matched, 'updated': len(rows_sql)}


# =====================================================================
# Module: check_lg
# =====================================================================

STATO_LG_MAP = {
    'ATTIVO': 'Attivato',
    'Attivato': 'Attivato',
    'KO': 'Rifiutato',
    'KO - REINSERIMENTO W3': 'Rifiutato',
    'KO - REINSERIMENTO DUFERCO': 'Rifiutato',
    'WIP': 'In lavorazione',
    'CESSAZIONE 30gg': 'In lavorazione',
    'Rifiutato': 'Rifiutato',
    'Annullato': 'Annullato',
    'In lavorazione': 'In lavorazione',
    'In attivazione': 'In attivazione',
    'Nuovo': 'Nuovo',
}


def module_check_lg(lookups, execute):
    print(f"\n=== Modulo: check_lg ===")
    path = CSV_DIR / 'check_lg.csv'
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    r = db_query("""
        SELECT pvcl.id AS pvcl_id, pvcl.contratto_id, a.cf_piva, vc.data_contratto::date AS day
        FROM post_vendita_controllo_lg pvcl
        JOIN vendita_contratti vc ON vc.id = pvcl.contratto_id
        JOIN anagrafica a ON a.id = vc.anagrafica_id;
    """)
    by_cf = defaultdict(list)
    for row in r.get('rows', []):
        cf_norm = (row['cf_piva'] or '').strip().upper()
        by_cf[cf_norm].append(row)

    records_2026 = 0
    matched = 0
    unmatched = []
    updates = []
    for rec in data:
        df = normalize_date_only(rec[col['DATA FIRMA']])
        if not df or df < '2026-01-01':
            continue
        records_2026 += 1
        cf = normalize_cf_piva(rec[col['C.F. o P.IVA']])
        cands = by_cf.get(cf, [])
        if not cands:
            unmatched.append(cf)
            continue
        target = datetime.strptime(df, '%Y-%m-%d').date()
        best = min(cands, key=lambda x: abs((datetime.strptime(x['day'], '%Y-%m-%d').date() - target).days) if x['day'] else 365)
        matched += 1
        updates.append({
            'pvcl_id': best['pvcl_id'],
            'contratto_id': best['contratto_id'],
            'stato': STATO_LG_MAP.get(rec[col['STATUS']].strip()),
        })

    print(f"  Righe 2026: {records_2026}, matched: {matched}, unmatched: {len(unmatched)}")

    if not execute:
        return {'count': records_2026, 'matched': matched, 'updated': 0}

    # Batch
    rows_sql = [f"({sql_uuid(u['pvcl_id'])}, {sql_str(u['stato'])})" for u in updates if u['stato']]
    if not rows_sql:
        return {'count': records_2026, 'matched': matched, 'updated': 0}
    sql = (
        "UPDATE post_vendita_controllo_lg pvcl SET stato = v.stato, updated_at = NOW() "
        "FROM (VALUES " + ', '.join(rows_sql) + ") AS v(id, stato) "
        "WHERE pvcl.id = v.id::uuid;"
    )
    db_exec(sql, timeout=300)
    return {'count': records_2026, 'matched': matched, 'updated': len(rows_sql)}


# =====================================================================
# Entrypoint
# =====================================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', help='Esegue scritture DB (default: dry-run)')
    parser.add_argument('--module', choices=['anagrafica', 'contratti', 'switch', 'apri_chiudi', 'comodato', 'ordini', 'protecta', 'ticket', 'segnalazioni', 'check_fisso', 'check_lg'], help='Esegue solo questo modulo')
    args = parser.parse_args()

    execute = args.execute
    mode = 'EXECUTE' if execute else 'DRY-RUN'
    print(f"=== Import konahub -> Mirox [{mode}] ===\n")

    lookups = Lookups()
    lookups.load_all()

    # Carica CSV contratti (serve quasi per ogni modulo)
    contratti, sk_pre, sk_invd = load_contratti_csv()
    print(f"\n=== CSV contratti ===")
    print(f"  righe 2026 utili: {len(contratti)}")
    print(f"  skippate pre-2026: {sk_pre}")
    print(f"  date invalide: {sk_invd}")

    mods_to_run = [args.module] if args.module else ['anagrafica', 'contratti']  # FK-safe order

    # Auto-prepend anagrafica per moduli che ne dipendono (solo dry-run, non doppio execute)
    if args.module in ('contratti', 'switch', 'apri_chiudi', 'comodato', 'ordini', 'protecta', 'check_fisso', 'check_lg'):
        if not execute:
            print("[Auto] Eseguo module anagrafica per popolare cache (dry-run)\n")
            module_anagrafica(lookups, contratti, False)

    results = {}
    for m in mods_to_run:
        if m == 'anagrafica':
            results[m] = module_anagrafica(lookups, contratti, execute)
        elif m == 'contratti':
            results[m] = module_contratti(lookups, contratti, execute)
        elif m == 'switch':
            results[m] = module_switch_sim(lookups, execute)
        elif m == 'apri_chiudi':
            results[m] = module_apri_chiudi(lookups, execute)
        elif m == 'comodato':
            results[m] = module_comodato(lookups, execute)
        elif m == 'ordini':
            results[m] = module_ordini(lookups, execute)
        elif m == 'protecta':
            results[m] = module_protecta(lookups, execute)
        elif m == 'ticket':
            results[m] = module_ticket(lookups, execute)
        elif m == 'segnalazioni':
            results[m] = module_segnalazioni(lookups, execute)
        elif m == 'check_fisso':
            results[m] = module_check_fisso(lookups, execute)
        elif m == 'check_lg':
            results[m] = module_check_lg(lookups, execute)
        else:
            print(f"\n[TODO] module: {m}")

    print(f"\n=== Summary ===")
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
