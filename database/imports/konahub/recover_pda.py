#!/usr/bin/env python3
"""Recupero cartelle PDA konahub non matchate al primo giro.
- Strip suffisso _2/_3 (secondo contratto/documenti dello stesso cliente)
- Match lenient: nome fuzzy + finestra data (exact -> +/-15gg -> unico nel 2026)
- Upload PDF mancanti su pratica esistente (nomi collision-safe vs file gia' presenti) + insert vendita_documenti
- Riporta le cartelle non recuperabili (contratto non nel CSV)
"""
import argparse, json, os, re, subprocess, ssl, unicodedata, mimetypes, uuid
import urllib.request, urllib.error, urllib.parse
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
DOCS = ROOT / 'database/imports/konahub/docs_extract/DOCUMENTI CRM/PDA + DOC'
SUPABASE_BIN = ROOT / '.bin' / 'supabase'
PROJECT_URL = 'https://lbgwamhjkjjfwgusafbi.supabase.co'
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY','').strip()
_ctx = ssl.create_default_context()


def db_query(sql, timeout=180):
    r = subprocess.run([str(SUPABASE_BIN),'db','query','--linked',sql],
        capture_output=True, text=True, timeout=timeout, cwd=str(ROOT))
    if r.returncode != 0:
        raise RuntimeError(f"DB err: {r.stderr[:300]}")
    out=r.stdout; s=out.find('{'); e=out.rfind('}')
    return json.loads(out[s:e+1])


def fold(s):
    if not s: return s
    s=unicodedata.normalize('NFKD',s); s=''.join(c for c in s if not unicodedata.combining(c))
    return s.encode('ascii','ignore').decode('ascii')
def nk(s): return re.sub(r'[^A-Z0-9]','',fold(s or '').upper())

def parse_folder(name):
    # strip suffisso _<num> finale
    base = re.sub(r'_(\d+)$', '', name)
    m=re.match(r'^(.+?)_(\d{1,2})[.](\d{1,2})[.](\d{2,4})$', base)
    if not m: return None,None
    y=m.group(4); y='20'+y if len(y)==2 else y
    try:
        return nk(m.group(1).replace('_','')), f"{y}-{int(m.group(3)):02d}-{int(m.group(2)):02d}"
    except ValueError:
        return None,None

def remap(orig):
    lower=orig.lower()
    if 'pda' in lower or 'contratto' in lower: return 'contratto_pda.pdf','contratto'
    if 'identit' in lower or 'documento' in lower or 'd_identi' in lower: return 'documento_identita.pdf','documento_identita'
    if 'bolletta' in lower: return 'copia_bolletta.pdf','copia_bolletta'
    if 'sim' in lower or 'mnp' in lower: return 'copia_sim_mnp.pdf','copia_sim_mnp'
    safe=re.sub(r'[^a-zA-Z0-9._-]','_',fold(orig))
    return safe,'altro'

def rest_upload(local_path, obj_path):
    url=f"{PROJECT_URL}/storage/v1/object/contratti-vendita/{urllib.parse.quote(obj_path)}"
    with open(local_path,'rb') as f: data=f.read()
    req=urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization',f'Bearer {KEY}'); req.add_header('apikey',KEY)
    ct,_=mimetypes.guess_type(str(local_path))
    req.add_header('Content-Type',ct or 'application/pdf'); req.add_header('x-upsert','true')
    for a in range(3):
        try:
            with urllib.request.urlopen(req,timeout=60,context=_ctx) as r:
                if r.status in (200,201): return True
                return False
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504) and a<2: continue
            return False
        except Exception:
            if a<2: continue
            return False
    return False


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--execute',action='store_true')
    p.add_argument('--workers',type=int,default=16)
    args=p.parse_args()
    if args.execute and not KEY:
        print("ERR: manca SUPABASE_SERVICE_ROLE_KEY"); return

    # pratiche 2026 con contratto + cartella
    r=db_query("""SELECT vp.id, vp.nome_cartella_storage, vp.data_pratica::date AS day, vp.anagrafica_id,
        a.ragione_sociale, a.nome_referente,
        (SELECT id FROM vendita_contratti WHERE pratica_id=vp.id LIMIT 1) AS contratto_id
      FROM vendita_pratiche vp JOIN anagrafica a ON a.id=vp.anagrafica_id
      WHERE vp.data_pratica>='2026-01-01';""", timeout=120)
    prat=r['rows']
    idx_exact=defaultdict(list)
    by_name=defaultdict(list)
    for pr in prat:
        for c in [pr['ragione_sociale'],pr['nome_referente']]:
            if c:
                idx_exact[(nk(c),pr['day'])].append(pr)
                by_name[nk(c)].append(pr)

    # quali cartelle sono gia' matchate al primo giro? (quelle con match esatto)
    folders=[f for f in DOCS.iterdir() if f.is_dir()]
    def first_pass_matched(folder):
        # replica logica rebuild_pda (senza strip suffix, senza finestra)
        m=re.match(r'^(.+?)_(\d{1,2})[.](\d{1,2})[.](\d{2,4})$', folder.name)
        if not m: return False
        y=m.group(4); y='20'+y if len(y)==2 else y
        k=nk(m.group(1).replace('_','')); di=f"{y}-{int(m.group(3)):02d}-{int(m.group(2)):02d}"
        if idx_exact.get((k,di)): return True
        for pr in [p for p in prat if p['day']==di]:
            for c in [pr['ragione_sociale'],pr['nome_referente']]:
                if c and (k in nk(c) or nk(c) in k): return True
        return False

    # esistenti storage per pratica cartella (per collision-safe)
    r2=db_query("SELECT storage_path FROM vendita_documenti WHERE storage_path ~ '^[0-9]{4}/[0-9]{2}/';", timeout=120)
    existing_paths=set(row['storage_path'] for row in r2['rows'])

    recovered=[]   # (src, obj_path, tipo, pratica)
    unrecoverable=[]
    for folder in folders:
        if first_pass_matched(folder):
            continue
        k,di=parse_folder(folder.name)
        if not di:
            unrecoverable.append((folder.name,'no-parse')); continue
        # match lenient
        cand=None
        # 1) exact
        if idx_exact.get((k,di)): cand=idx_exact[(k,di)][0]
        # 2) name fuzzy + finestra data
        if not cand:
            target=datetime.strptime(di,'%Y-%m-%d').date()
            name_cands=[]
            for nkk,prs in by_name.items():
                if len(k)>4 and len(nkk)>4 and (k in nkk or nkk in k):
                    name_cands.extend(prs)
            if name_cands:
                # scegli data piu' vicina
                cand=min(name_cands, key=lambda pr: abs((datetime.strptime(pr['day'],'%Y-%m-%d').date()-target).days))
                # solo se entro 20 giorni
                if abs((datetime.strptime(cand['day'],'%Y-%m-%d').date()-target).days) > 20:
                    cand=None
        if not cand:
            unrecoverable.append((folder.name, 'no-pratica')); continue
        # costruisci upload targets
        d=datetime.strptime(cand['day'],'%Y-%m-%d')
        yyyy_mm=f"{d.year}/{d.month:02d}"
        cartella=cand['nome_cartella_storage']
        for file in sorted(folder.iterdir()):
            if not file.is_file(): continue
            new_name,tipo=remap(file.name)
            # collision-safe vs esistenti
            base=new_name
            n=1
            obj_path=f"{yyyy_mm}/{cartella}/{new_name}"
            while obj_path in existing_paths or obj_path in [r[1] for r in recovered]:
                n+=1
                nm=base.replace('.pdf',f'_{n}.pdf')
                obj_path=f"{yyyy_mm}/{cartella}/{nm}"
                new_name=nm
            existing_paths.add(obj_path)
            recovered.append((str(file), obj_path, tipo, cand, new_name))

    print(f"=== Recupero PDA ===")
    print(f"  File da recuperare: {len(recovered)}")
    print(f"  Cartelle NON recuperabili (non nel CSV): {len(unrecoverable)}")
    for n,why in unrecoverable: print(f"     [{why}] {n}")

    if not args.execute:
        print("\n  [DRY-RUN] sample:")
        for src,obj,tipo,pr,nm in recovered[:8]:
            print(f"     {obj} [{tipo}]")
        return

    # upload
    ok=0; fail=0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs={ex.submit(rest_upload, r[0], r[1]): r for r in recovered}
        for fut in as_completed(futs):
            if fut.result(): ok+=1
            else: fail+=1
    print(f"\n  Upload: {ok} ok, {fail} fail")

    # insert vendita_documenti (solo tipo != altro)
    docs=[r for r in recovered if r[2]!='altro']
    BATCH=200; ins=0
    for i in range(0,len(docs),BATCH):
        sub=docs[i:i+BATCH]
        vals=[]
        for src,obj,tipo,pr,nm in sub:
            cid=f"'{pr['contratto_id']}'::uuid" if pr['contratto_id'] else 'NULL'
            vals.append(f"('{uuid.uuid4()}'::uuid, {cid}, '{pr['id']}'::uuid, '{pr['anagrafica_id']}'::uuid, '{tipo}', '{nm.replace(chr(39),chr(39)*2)}', 'contratti-vendita', '{obj.replace(chr(39),chr(39)*2)}')")
        db_query("INSERT INTO vendita_documenti (id,contratto_id,pratica_id,anagrafica_id,tipo_documento,file_name,storage_bucket,storage_path) VALUES "+', '.join(vals)+" ON CONFLICT DO NOTHING;", timeout=120)
        ins+=len(sub)
    print(f"  vendita_documenti inseriti: {ins}")


if __name__=='__main__':
    main()
