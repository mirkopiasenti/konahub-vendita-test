#!/usr/bin/env python3
"""Ultimo giro: match cartelle PDA residue via similarita' (difflib) su finestra data.
Per refusi tipo GIAMPAOLA/GIANPAOLA, MILOTTO/MILIOTO, MOIRA/MORIA.
"""
import argparse, json, os, re, subprocess, ssl, unicodedata, mimetypes, uuid
import urllib.request, urllib.error, urllib.parse
from collections import defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
DOCS = ROOT / 'database/imports/konahub/docs_extract/DOCUMENTI CRM/PDA + DOC'
SUPABASE_BIN = ROOT / '.bin' / 'supabase'
PROJECT_URL = 'https://lbgwamhjkjjfwgusafbi.supabase.co'
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY','').strip()
_ctx = ssl.create_default_context()

def db_query(sql, timeout=180):
    r=subprocess.run([str(SUPABASE_BIN),'db','query','--linked',sql],capture_output=True,text=True,timeout=timeout,cwd=str(ROOT))
    if r.returncode!=0: raise RuntimeError(f"DB err: {r.stderr[:300]}")
    out=r.stdout; s=out.find('{'); e=out.rfind('}')
    return json.loads(out[s:e+1])

def fold(s):
    if not s: return s
    s=unicodedata.normalize('NFKD',s); s=''.join(c for c in s if not unicodedata.combining(c))
    return s.encode('ascii','ignore').decode('ascii')
def nk(s): return re.sub(r'[^A-Z0-9]','',fold(s or '').upper())

def parse_folder(name):
    base=re.sub(r'_(\d+)$','',name)
    m=re.match(r'^(.+?)_(\d{1,2})[.](\d{1,2})[.](\d{2,4})$',base)
    if not m: return None,None
    y=m.group(4); y='20'+y if len(y)==2 else y
    try: return nk(m.group(1).replace('_','')), f"{y}-{int(m.group(3)):02d}-{int(m.group(2)):02d}"
    except ValueError: return None,None

def remap(orig):
    lower=orig.lower()
    if 'pda' in lower or 'contratto' in lower: return 'contratto_pda.pdf','contratto'
    if 'identit' in lower or 'documento' in lower or 'd_identi' in lower: return 'documento_identita.pdf','documento_identita'
    if 'bolletta' in lower: return 'copia_bolletta.pdf','copia_bolletta'
    if 'sim' in lower or 'mnp' in lower: return 'copia_sim_mnp.pdf','copia_sim_mnp'
    return re.sub(r'[^a-zA-Z0-9._-]','_',fold(orig)),'altro'

def rest_upload(local_path,obj_path):
    url=f"{PROJECT_URL}/storage/v1/object/contratti-vendita/{urllib.parse.quote(obj_path)}"
    with open(local_path,'rb') as f: data=f.read()
    req=urllib.request.Request(url,data=data,method='POST')
    req.add_header('Authorization',f'Bearer {KEY}');req.add_header('apikey',KEY)
    ct,_=mimetypes.guess_type(str(local_path));req.add_header('Content-Type',ct or 'application/pdf');req.add_header('x-upsert','true')
    for a in range(3):
        try:
            with urllib.request.urlopen(req,timeout=60,context=_ctx) as r:
                return r.status in (200,201)
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504) and a<2: continue
            return False
        except Exception:
            if a<2: continue
            return False
    return False

def already_matched(folder_name, idx_exact, by_name, prat):
    # replica: se rebuild o recover l'avrebbe preso (exact o substring o edit-window)
    k,di=parse_folder(folder_name)
    if not di: return False
    if idx_exact.get((k,di)): return True
    target=datetime.strptime(di,'%Y-%m-%d').date()
    for nkk,prs in by_name.items():
        if len(k)>4 and len(nkk)>4 and (k in nkk or nkk in k):
            for pr in prs:
                if abs((datetime.strptime(pr['day'],'%Y-%m-%d').date()-target).days)<=20: return True
    return False

def main():
    p=argparse.ArgumentParser(); p.add_argument('--execute',action='store_true'); p.add_argument('--workers',type=int,default=16)
    p.add_argument('--threshold',type=float,default=0.82); args=p.parse_args()
    if args.execute and not KEY: print("ERR key"); return

    r=db_query("""SELECT vp.id, vp.nome_cartella_storage, vp.data_pratica::date AS day, vp.anagrafica_id,
        a.ragione_sociale, a.nome_referente,
        (SELECT id FROM vendita_contratti WHERE pratica_id=vp.id LIMIT 1) AS contratto_id
      FROM vendita_pratiche vp JOIN anagrafica a ON a.id=vp.anagrafica_id WHERE vp.data_pratica>='2026-01-01';""",timeout=120)
    prat=r['rows']
    idx_exact=defaultdict(list); by_name=defaultdict(list)
    for pr in prat:
        for c in [pr['ragione_sociale'],pr['nome_referente']]:
            if c: idx_exact[(nk(c),pr['day'])].append(pr); by_name[nk(c)].append(pr)

    r2=db_query("SELECT storage_path FROM vendita_documenti WHERE storage_path ~ '^[0-9]{4}/[0-9]{2}/';",timeout=120)
    existing=set(row['storage_path'] for row in r2['rows'])

    folders=[f for f in DOCS.iterdir() if f.is_dir()]
    matches=[]; still_no=[]
    for folder in folders:
        if already_matched(folder.name, idx_exact, by_name, prat): continue
        k,di=parse_folder(folder.name)
        if not di: still_no.append((folder.name,'no-parse')); continue
        target=datetime.strptime(di,'%Y-%m-%d').date()
        # candidati entro 20gg, best similarity nome
        best=None; best_score=0
        for pr in prat:
            dd=abs((datetime.strptime(pr['day'],'%Y-%m-%d').date()-target).days)
            if dd>20: continue
            for c in [pr['ragione_sociale'],pr['nome_referente']]:
                if not c: continue
                score=SequenceMatcher(None,k,nk(c)).ratio()
                # bonus se stessa data
                if dd==0: score+=0.05
                if score>best_score: best_score=score; best=pr
        if best and best_score>=args.threshold:
            matches.append((folder,best,best_score))
        else:
            still_no.append((folder.name, f'no-match(best={best_score:.2f})'))

    print(f"=== Fuzzy recovery ===")
    print(f"  Match trovati (>= {args.threshold}): {len(matches)}")
    for folder,pr,sc in matches:
        print(f"     {folder.name}  ->  {pr['ragione_sociale']} {pr['day']} (sim {sc:.2f})")
    print(f"  Ancora NON matchati (davvero non nel CSV): {len(still_no)}")
    for n,why in still_no: print(f"     [{why}] {n}")

    if not args.execute: return

    # build upload list collision-safe
    uploads=[]
    for folder,pr,sc in matches:
        d=datetime.strptime(pr['day'],'%Y-%m-%d'); yyyy_mm=f"{d.year}/{d.month:02d}"; cartella=pr['nome_cartella_storage']
        for file in sorted(folder.iterdir()):
            if not file.is_file(): continue
            new_name,tipo=remap(file.name); base=new_name; n=1
            obj=f"{yyyy_mm}/{cartella}/{new_name}"
            while obj in existing or obj in [u[1] for u in uploads]:
                n+=1; new_name=base.replace('.pdf',f'_{n}.pdf'); obj=f"{yyyy_mm}/{cartella}/{new_name}"
            existing.add(obj); uploads.append((str(file),obj,tipo,pr,new_name))

    ok=0;fail=0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs={ex.submit(rest_upload,u[0],u[1]):u for u in uploads}
        for fut in as_completed(futs):
            if fut.result(): ok+=1
            else: fail+=1
    print(f"  Upload: {ok} ok, {fail} fail")
    docs=[u for u in uploads if u[2]!='altro']
    if docs:
        vals=[]
        for src,obj,tipo,pr,nm in docs:
            cid=f"'{pr['contratto_id']}'::uuid" if pr['contratto_id'] else 'NULL'
            vals.append(f"('{uuid.uuid4()}'::uuid,{cid},'{pr['id']}'::uuid,'{pr['anagrafica_id']}'::uuid,'{tipo}','{nm.replace(chr(39),chr(39)*2)}','contratti-vendita','{obj.replace(chr(39),chr(39)*2)}')")
        db_query("INSERT INTO vendita_documenti (id,contratto_id,pratica_id,anagrafica_id,tipo_documento,file_name,storage_bucket,storage_path) VALUES "+', '.join(vals)+" ON CONFLICT DO NOTHING;",timeout=120)
        print(f"  vendita_documenti inseriti: {len(docs)}")

if __name__=='__main__': main()
