/* ============================================================
   MIROX UPLOAD — Binding condiviso per drop-zone file upload
   Pattern HTML atteso:
     <div class="mx-drop-zone" data-target="myInput"
          data-accept=".pdf"           // opzionale, default .pdf
          data-multiple="false">        // opzionale, default false
       <div class="mx-drop-text">Trascina qui il file PDF o clicca per selezionare</div>
       <div class="mx-drop-hint">PDF — un solo file</div>
     </div>
     <input type="file" id="myInput" accept=".pdf" style="display:none">
     <div class="mx-files-list" data-list-for="myInput"></div>
   Espone window.MiroxUpload con:
     bindAll(rootEl?)  -> ri-attacca i listener (utile dopo render dinamici)
     clearFile(inputId) -> reset
     renderList(inputId) -> ridisegna la lista per quell'input
   Si auto-attiva su DOMContentLoaded.
   ============================================================ */
(function () {
    if (window.MiroxUpload) return;

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function renderList(inputId) {
        const inp = document.getElementById(inputId);
        if (!inp) return;
        const list = document.querySelector(`.mx-files-list[data-list-for="${inputId}"]`);
        const dz = document.querySelector(`.mx-drop-zone[data-target="${inputId}"]`);
        if (!list && !dz) return;
        if (list) list.innerHTML = '';
        if (inp.files && inp.files.length > 0) {
            if (dz) dz.classList.add('has-file');
            if (list) {
                Array.from(inp.files).forEach(f => {
                    const row = document.createElement('div');
                    row.className = 'mx-file-row';
                    row.innerHTML = `<span class="mx-file-name">${esc(f.name)}</span>` +
                        `<button type="button" class="mx-file-remove" title="Rimuovi" data-mx-clear="${esc(inputId)}">×</button>`;
                    list.appendChild(row);
                });
            }
        } else if (dz) {
            dz.classList.remove('has-file');
        }
    }

    function clearFile(inputId) {
        const inp = document.getElementById(inputId);
        if (inp) { inp.value = ''; renderList(inputId); }
    }

    function _accept(dz, file) {
        const acc = (dz.dataset.accept || '.pdf').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (!acc.length) return true;
        const name = (file.name || '').toLowerCase();
        const type = (file.type || '').toLowerCase();
        return acc.some(pattern => {
            if (pattern.startsWith('.')) return name.endsWith(pattern);
            if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
            return type === pattern;
        });
    }

    function bindZone(dz) {
        if (dz.__mxBound) return;
        dz.__mxBound = true;
        const targetId = dz.dataset.target;
        if (!targetId) return;
        const inp = document.getElementById(targetId);
        if (!inp) return;

        dz.addEventListener('click', () => inp.click());
        inp.addEventListener('change', () => renderList(targetId));
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', (e) => {
            e.preventDefault();
            dz.classList.remove('dragover');
            const list = e.dataTransfer && e.dataTransfer.files;
            if (!list || !list.length) return;
            const multiple = inp.multiple || dz.dataset.multiple === 'true';
            const files = Array.from(list).filter(f => _accept(dz, f));
            if (!files.length) return;
            const dt = new DataTransfer();
            (multiple ? files : [files[0]]).forEach(f => dt.items.add(f));
            inp.files = dt.files;
            renderList(targetId);
            inp.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    function bindAll(root) {
        const scope = root || document;
        scope.querySelectorAll('.mx-drop-zone').forEach(bindZone);
        // Re-render iniziale di tutte le liste (se gli input hanno già un file)
        scope.querySelectorAll('.mx-files-list[data-list-for]').forEach(list => {
            renderList(list.dataset.listFor);
        });
    }

    // Delegation: click su .mx-file-remove
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.matches && t.matches('.mx-file-remove[data-mx-clear]')) {
            e.preventDefault();
            clearFile(t.dataset.mxClear);
        }
    });

    window.MiroxUpload = { bindAll, clearFile, renderList };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => bindAll());
    } else {
        bindAll();
    }
})();
