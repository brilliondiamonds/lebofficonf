/* ═══════════════════════════════════════════════
   LE BOFFI — Admin Panel Logic
   GitHub API Integration for Materials Management
   ═══════════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── CONFIG ──────────────────────
    const REPO_OWNER = 'brilliondiamonds';
    const REPO_NAME = 'lebofficonf';
    const MATERIALS_PATH = 'materials.json';
    const MODELS_PATH = 'models.json';
    const IMAGES_BASE = 'images/materiali';
    const MODELS_IMAGES_BASE = 'images/modelli';
    const API_BASE = 'https://api.github.com';

    // ─── STATE ───────────────────────
    let token = '';

    let materialsData = [];
    let originalJSON = '';
    let fileSha = '';

    let modelsData = [];
    let originalModelsJSON = '';
    let modelsFileSha = '';

    let pendingSwatchImage = null; // { base64, fileName }
    let pendingBaseImage = null;   // { base64, fileName }
    let pendingMaskImage = null;   // { base64, fileName }

    let editingCategoryIndex = -1;
    let editingModelCategoryIndex = -1;
    let editingModelIndex = -1;
    let editingModelCatParentIndex = -1;
    let deletingTarget = null; // { type: 'category'|'swatch'|'model-cat'|'model'|'mask', catIdx, swIdx?, modelCatIdx?, modelIdx?, maskIdx? }

    let currentTab = 'materiali'; // 'materiali' | 'modelli'

    // ─── DOM REFS ────────────────────
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    const tokenInput = document.getElementById('tokenInput');
    const loginError = document.getElementById('loginError');
    const categoriesList = document.getElementById('categoriesList');
    const modelsList = document.getElementById('modelsList');
    const statusBadge = document.getElementById('statusBadge');
    const catCount = document.getElementById('catCount');
    const modelCount = document.getElementById('modelCount');
    const searchInput = document.getElementById('searchInput');
    const searchModelInput = document.getElementById('searchModelInput');
    const toast = document.getElementById('toast');

    const toolbarMateriali = document.getElementById('toolbarMateriali');
    const toolbarModelli = document.getElementById('toolbarModelli');

    // ─── INIT ────────────────────────
    function init() {
        const saved = localStorage.getItem('leboffi_gh_token');
        if (saved) {
            token = saved;
            tokenInput.value = saved;
        }

        // Login
        document.getElementById('btnLogin').addEventListener('click', doLogin);
        tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

        // Toggle token visibility
        document.getElementById('toggleToken').addEventListener('click', () => {
            tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
        });

        // Logout
        document.getElementById('btnLogout').addEventListener('click', () => {
            localStorage.removeItem('leboffi_gh_token');
            token = '';
            dashboard.classList.add('hidden');
            loginScreen.classList.remove('hidden');
            loginError.textContent = '';
        });

        document.querySelectorAll('.admin-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');

                const targetId = e.target.dataset.tab;
                currentTab = targetId;

                if (targetId === 'materiali') {
                    toolbarMateriali.classList.remove('hidden');
                    toolbarMateriali.classList.add('active');
                    toolbarModelli.classList.add('hidden');
                    toolbarModelli.classList.remove('active');

                    categoriesList.classList.remove('hidden');
                    categoriesList.classList.add('active');
                    modelsList.classList.add('hidden');
                    modelsList.classList.remove('active');
                } else if (targetId === 'modelli') {
                    toolbarModelli.classList.remove('hidden');
                    toolbarModelli.classList.add('active');
                    toolbarMateriali.classList.add('hidden');
                    toolbarMateriali.classList.remove('active');

                    modelsList.classList.remove('hidden');
                    modelsList.classList.add('active');
                    categoriesList.classList.add('hidden');
                    categoriesList.classList.remove('active');
                }
            });
        });

        // Add category
        document.getElementById('btnAddCategory').addEventListener('click', () => {
            editingCategoryIndex = -1;
            document.getElementById('modalCategoryTitle').textContent = 'Nuova Categoria';
            document.getElementById('catNameInput').value = '';
            document.getElementById('catFolderInput').value = '';
            openModal('modalCategory');
        });

        // Confirm category
        document.getElementById('btnConfirmCategory').addEventListener('click', confirmCategory);

        // Confirm swatch
        document.getElementById('btnConfirmSwatch').addEventListener('click', confirmSwatch);

        // Add model category
        document.getElementById('btnAddModelCategory').addEventListener('click', () => {
            editingModelCategoryIndex = -1;
            document.getElementById('modalModelCategoryTitle').textContent = 'Nuova Categoria Modelli';
            document.getElementById('modelCatNameInput').value = '';
            openModal('modalModelCategory');
        });

        // Confirm model category
        document.getElementById('btnConfirmModelCategory').addEventListener('click', confirmModelCategory);

        // Confirm model
        document.getElementById('btnConfirmModel').addEventListener('click', confirmModel);

        // Confirm mask
        document.getElementById('btnConfirmMask').addEventListener('click', confirmMask);

        // Save & Publish Models
        document.getElementById('btnSavePublishModelli').addEventListener('click', saveAndPublishModels);

        // Confirm delete
        document.getElementById('btnConfirmDelete').addEventListener('click', confirmDelete);

        // Save & Publish
        document.getElementById('btnSavePublish').addEventListener('click', saveAndPublish);

        // Search
        searchInput.addEventListener('input', renderCategories);

        // Modal close buttons
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => closeModal(btn.dataset.close));
        });

        // Upload area interactions
        setupUploadArea();

        // Delegate action buttons (once, on the container)
        categoriesList.addEventListener('click', handleAction);
        modelsList.addEventListener('click', handleAction);

        // Auto-login if token exists
        if (saved) doLogin();
    }

    // ─── HELPERS (API / JSON) ─────────
    async function safeJson(response, label) {
        const text = await response.text();
        if (!text || !text.trim()) throw new Error((label || 'Risposta') + ' vuota dal server');
        try {
            return JSON.parse(text);
        } catch (e) {
            console.error(`Errore parse JSON per ${label}:`, text.substring(0, 200) + '...');
            throw new Error((label || 'Risposta') + ' non è JSON valido: ' + e.message);
        }
    }

    function safeParseJson(str, fileLabel) {
        const s = (str && String(str).trim()) || '[]';
        try {
            const out = JSON.parse(s);
            return Array.isArray(out) ? out : [];
        } catch (e) {
            console.error(`Errore parse JSON contenuto file ${fileLabel}:`, s.substring(0, 200) + '...');
            throw new Error('Il file ' + (fileLabel || '') + ' non contiene JSON valido: ' + e.message);
        }
    }

    // ─── AUTH ────────────────────────
    async function doLogin() {
        const t = tokenInput.value.trim();
        if (!t) {
            loginError.textContent = 'Inserisci un token valido.';
            return;
        }
        loginError.textContent = '';
        try {
            const res = await ghFetch('/user');
            if (!res.ok) throw new Error('Token non valido');
            const user = await safeJson(res, 'Profilo utente');
            token = t;
            localStorage.setItem('leboffi_gh_token', t);

            // Check repo write permissions
            const repoRes = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}`);
            let hasPush = false;
            if (repoRes.ok) {
                const repoData = await safeJson(repoRes, 'Dati repository');
                hasPush = repoData.permissions && repoData.permissions.push;
            }

            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');

            if (!hasPush) {
                showToast('⚠️ Il token non ha permessi di scrittura sul repo. Usa un token del proprietario del repo.', 'error');
            }

            await loadData();
        } catch (err) {
            loginError.textContent = '❌ ' + err.message;
        }
    }

    // ─── GITHUB API ──────────────────
    function ghFetch(path, options = {}) {
        const t = tokenInput.value.trim() || token;
        return fetch(API_BASE + path, {
            ...options,
            headers: {
                'Authorization': 'Bearer ' + t,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
    }

    /** Carica un JSON da GitHub. Usa il download_url (raw.githubusercontent.com) per il contenuto
     *  perché non ha limiti di dimensione, e la Contents API solo per lo SHA. */
    async function fetchJsonFromGitHubOrLocal(path) {
        const ts = new Date().getTime();
        try {
            const res = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?v=${ts}`);
            if (!res.ok) return { source: 'local', sha: null };
            const meta = await safeJson(res, 'metadati ' + path);

            const rawUrl = meta.download_url || `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${path}`;
            const rawRes = await fetch(rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'v=' + ts);
            if (!rawRes.ok) throw new Error('Impossibile scaricare ' + path + ' (HTTP ' + rawRes.status + ')');

            const raw = await rawRes.text();
            const parsed = safeParseJson(raw, path);
            return { source: 'github', sha: meta.sha, data: parsed };
        } catch (e) {
            console.error('Errore fetch GitHub per', path, e);
            return { source: 'local', sha: null };
        }
    }

    /** Carica un JSON dalla stessa origine (es. /materials.json su localhost). */
    async function fetchJsonLocal(path) {
        const ts = new Date().getTime();
        const res = await fetch(path + '?v=' + ts);
        if (!res.ok) return null;
        const text = await res.text();
        const raw = (text && text.trim()) || '[]';
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return null;
        }
    }

    async function loadData() {
        categoriesList.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <span>Caricamento materiali…</span>
            </div>`;

        modelsList.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <span>Caricamento modelli…</span>
            </div>`;

        function setError(msg) {
            const html = `<p style="text-align:center;color:var(--danger);padding:40px;">❌ ${esc(msg)}</p>`;
            categoriesList.innerHTML = html;
            modelsList.innerHTML = html;
        }

        try {
            // 1) Materiali: prima GitHub, poi fallback locale
            const matResult = await fetchJsonFromGitHubOrLocal(MATERIALS_PATH);
            if (matResult.source === 'github' && matResult.data) {
                fileSha = matResult.sha;
                materialsData = matResult.data;
            } else {
                const localMat = await fetchJsonLocal(MATERIALS_PATH);
                if (localMat) {
                    materialsData = localMat;
                    fileSha = '';
                    showToast('Materiali caricati da questo server (non da GitHub)', 'info');
                } else {
                    materialsData = [];
                    fileSha = '';
                }
            }
            originalJSON = JSON.stringify(materialsData);

            // 2) Modelli: prima GitHub, poi fallback locale
            const modResult = await fetchJsonFromGitHubOrLocal(MODELS_PATH);
            if (modResult.source === 'github' && modResult.data) {
                modelsFileSha = modResult.sha;
                modelsData = modResult.data;
            } else {
                const localMod = await fetchJsonLocal(MODELS_PATH);
                if (localMod) {
                    modelsData = localMod;
                    modelsFileSha = '';
                    showToast('Modelli caricati da questo server (non da GitHub)', 'info');
                } else {
                    modelsData = [];
                    modelsFileSha = '';
                }
            }
            originalModelsJSON = JSON.stringify(modelsData);

            renderCategories();
            renderModels();
            updateStatus();
        } catch (err) {
            setError(err.message || 'Errore sconosciuto');
        }
    }

    function utf8ToBase64(str) {
        const bytes = new TextEncoder().encode(str);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    function base64ToUtf8(b64) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    async function commitFile(path, content, message, sha) {
        const body = {
            message: message,
            content: utf8ToBase64(content)
        };
        if (sha) body.sha = sha;
        const res = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            let err = {};
            try { err = await res.json(); } catch (_) { err = { message: await res.text() || 'Errore sconosciuto' }; }
            console.error('[Admin] Commit error:', res.status, err);
            if (res.status === 404) {
                throw new Error('Nessun permesso di scrittura. Il token deve appartenere al proprietario del repo oppure a un collaboratore con permesso "Write".');
            }
            throw new Error(err.message || 'Errore nel commit (HTTP ' + res.status + ')');
        }
        return safeJson(res, 'Risposta commit');
    }

    async function uploadImage(path, base64Data, message) {
        // Check if file exists
        let sha = undefined;
        try {
            const check = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`);
            if (check.ok) {
                const existing = await safeJson(check, 'Contenuto file');
                sha = existing.sha;
            }
        } catch (e) { /* file doesn't exist o risposta non valida */ }

        const body = {
            message: message,
            content: base64Data
        };
        if (sha) body.sha = sha;

        const res = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            let err = {};
            try { err = await res.json(); } catch (_) { err = { message: await res.text() || 'Errore upload' }; }
            throw new Error(err.message || 'Errore upload immagine');
        }
        return safeJson(res, 'Risposta upload');
    }

    // ─── RENDER ──────────────────────
    function renderCategories() {
        const query = searchInput.value.trim().toLowerCase();

        const openIdxs = new Set();
        document.querySelectorAll('#categoriesList .category-card.open').forEach(c => {
            if (c.dataset.idx) openIdxs.add(c.dataset.idx);
        });

        categoriesList.innerHTML = '';

        let filtered = materialsData;
        if (query) {
            filtered = materialsData.filter(cat =>
                cat.name.toLowerCase().includes(query) ||
                cat.swatches.some(sw => sw.label.toLowerCase().includes(query))
            );
        }

        const total = materialsData.reduce((sum, c) => sum + c.swatches.length, 0);
        catCount.textContent = `${materialsData.length} categorie · ${total} swatch`;

        if (filtered.length === 0) {
            categoriesList.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:40px;">Nessun risultato</p>`;
            return;
        }

        filtered.forEach((cat, filteredIdx) => {
            const realIdx = materialsData.indexOf(cat);
            const card = document.createElement('div');
            card.className = 'category-card';
            if (openIdxs.has(realIdx.toString())) card.classList.add('open');
            card.dataset.idx = realIdx;

            // Header
            const header = document.createElement('div');
            header.className = 'cat-header';
            header.innerHTML = `
                <div class="cat-header-left">
                    <svg class="cat-toggle" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                    <span class="cat-name">${esc(cat.name)}</span>
                    <span class="cat-count">${cat.swatches.length}</span>
                    <span class="cat-folder">${esc(cat.folder)}</span>
                </div>
                <div class="cat-header-right">
                    <button class="btn-icon-action" data-action="edit-cat" data-idx="${realIdx}" title="Modifica">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn-icon-action danger" data-action="delete-cat" data-idx="${realIdx}" title="Elimina">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>`;

            header.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]')) return;
                card.classList.toggle('open');
            });

            // Body
            const body = document.createElement('div');
            body.className = 'cat-body';

            // Actions bar
            const actionsBar = document.createElement('div');
            actionsBar.className = 'cat-actions-bar';
            actionsBar.innerHTML = `
                <span>${cat.swatches.length} swatch nella categoria</span>
                <button class="btn-icon-action" data-action="add-swatch" data-idx="${realIdx}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Aggiungi swatch
                </button>`;

            // Swatch grid
            const grid = document.createElement('div');
            grid.className = 'admin-swatch-grid';

            cat.swatches.forEach((sw, swIdx) => {
                let imgSrc = encodeURI(`${IMAGES_BASE}/${cat.folder}/${sw.file}`);
                if (sw._pendingUpload) {
                    imgSrc = 'data:image/png;base64,' + sw._pendingUpload.base64;
                }
                const fallbackSrc = `https://raw.githubusercontent.com/brilliondiamonds/lebofficonf/main/${encodeURI(IMAGES_BASE + '/' + cat.folder + '/' + sw.file)}?v=${new Date().getTime()}`;

                const swCard = document.createElement('div');
                swCard.className = 'admin-swatch-card';
                swCard.draggable = true;
                swCard.dataset.catIdx = realIdx;
                swCard.dataset.swIdx = swIdx;

                swCard.innerHTML = `
                    <img class="admin-swatch-img" draggable="false" src="${imgSrc}" alt="${esc(sw.label)}" loading="lazy" 
                         onerror="if(!this.dataset.fb){ this.dataset.fb='1'; this.src='${fallbackSrc}'; } else { this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%231a1a1f%22 width=%22100%22 height=%22100%22/><text fill=%22%235a5a6a%22 x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2212%22>No img</text></svg>'; }"/>
                    <div class="admin-swatch-info">
                        <span class="admin-swatch-name" title="${esc(sw.label)}">${esc(sw.label)}</span>
                        <button class="admin-swatch-delete" data-action="delete-swatch" data-cat-idx="${realIdx}" data-sw-idx="${swIdx}" title="Rimuovi">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>`;

                // --- Drag and Drop + Multi-Select Events ---

                // Toggle selection on click (unless clicking control buttons)
                swCard.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    swCard.classList.toggle('selected');
                });

                // Start Drag
                swCard.addEventListener('dragstart', (e) => {
                    // If dragged item wasn't selected, select only it
                    if (!swCard.classList.contains('selected')) {
                        document.querySelectorAll('.admin-swatch-card.selected').forEach(el => el.classList.remove('selected'));
                        swCard.classList.add('selected');
                    }

                    // Gather all currently selected indices
                    const selectedEls = document.querySelectorAll('.admin-swatch-card.selected');
                    const selectedData = Array.from(selectedEls).map(el => ({
                        catIdx: parseInt(el.dataset.catIdx),
                        swIdx: parseInt(el.dataset.swIdx)
                    }));

                    const jsonData = JSON.stringify(selectedData);
                    e.dataTransfer.setData('application/json', jsonData);
                    e.dataTransfer.setData('text/plain', jsonData);
                    e.dataTransfer.effectAllowed = 'move';

                    // Optional visual feedback for drag image could go here
                });

                // Handle Drag Over elements
                swCard.addEventListener('dragenter', (e) => {
                    e.preventDefault();
                    swCard.classList.add('drag-over');
                });
                swCard.addEventListener('dragover', (e) => {
                    e.preventDefault(); // Necessary to allow dropping
                    e.dataTransfer.dropEffect = 'move';
                    swCard.classList.add('drag-over');
                });

                swCard.addEventListener('dragleave', () => {
                    swCard.classList.remove('drag-over');
                });

                // Drop on another swatch
                swCard.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    swCard.classList.remove('drag-over');

                    let dataStr = e.dataTransfer.getData('application/json');
                    if (!dataStr) dataStr = e.dataTransfer.getData('text/plain');
                    if (!dataStr) return;

                    let draggedData = [];
                    try { draggedData = JSON.parse(dataStr); } catch (e) { return; }

                    if (!draggedData || draggedData.length === 0) return;

                    const targetCatIdx = parseInt(swCard.dataset.catIdx);
                    // Rilascio PRIMA o DOPO? Per semplicità inseriamo prima dell'elemento target
                    const targetSwIdx = parseInt(swCard.dataset.swIdx);

                    handleDropItems(draggedData, targetCatIdx, targetSwIdx);
                });

                grid.appendChild(swCard);
            });

            body.appendChild(actionsBar);

            // Allow dropping onto an empty or partially populated grid
            grid.addEventListener('dragenter', (e) => {
                e.preventDefault();
                grid.classList.add('drag-over');
            });
            grid.addEventListener('dragover', (e) => {
                e.preventDefault();
                grid.classList.add('drag-over');
            });
            grid.addEventListener('dragleave', () => {
                grid.classList.remove('drag-over');
            });
            grid.addEventListener('drop', (e) => {
                e.preventDefault();
                grid.classList.remove('drag-over');
                // Se viene rilasciato nell'area vuota della grid, aggiungi alla fine di questa cat
                if (e.target === grid || e.target.closest('.admin-swatch-grid') === grid) {
                    let dataStr = e.dataTransfer.getData('application/json');
                    if (!dataStr) dataStr = e.dataTransfer.getData('text/plain');
                    if (!dataStr) return;

                    let draggedData = [];
                    try { draggedData = JSON.parse(dataStr); } catch (err) { return; }

                    if (!draggedData || draggedData.length === 0) return;

                    const targetCatIdx = parseInt(card.dataset.idx);
                    const targetSwIdx = materialsData[targetCatIdx].swatches.length; // insert at end
                    handleDropItems(draggedData, targetCatIdx, targetSwIdx);
                }
            });

            body.appendChild(grid);
            card.appendChild(header);
            card.appendChild(body);
            categoriesList.appendChild(card);
        });
    }

    // ─── ACTION HANDLER ──────────────
    function renderModels() {
        const query = searchModelInput.value.trim().toLowerCase();

        const openIdxs = new Set();
        document.querySelectorAll('#modelsList .category-card.open').forEach(c => {
            if (c.dataset.modelCatIdx) openIdxs.add(c.dataset.modelCatIdx);
        });

        modelsList.innerHTML = '';

        let filtered = modelsData;
        if (query) {
            filtered = modelsData.filter(cat =>
                cat.name.toLowerCase().includes(query) ||
                (cat.models && cat.models.some(m => m.name.toLowerCase().includes(query) || m.masks.some(mk => mk.label.toLowerCase().includes(query))))
            );
        }

        const totalModels = modelsData.reduce((sum, c) => sum + (c.models ? c.models.length : 0), 0);
        const totalMasks = modelsData.reduce((sum, c) => sum + (c.models ? c.models.reduce((s2, m) => s2 + m.masks.length, 0) : 0), 0);
        modelCount.textContent = `${modelsData.length} categorie · ${totalModels} modelli · ${totalMasks} maschere`;

        if (filtered.length === 0) {
            modelsList.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:40px;">Nessun risultato</p>`;
            return;
        }

        filtered.forEach((cat, filteredIdx) => {
            const realCatIdx = modelsData.indexOf(cat);
            const card = document.createElement('div');
            card.className = 'category-card';
            if (openIdxs.has(realCatIdx.toString())) card.classList.add('open');
            card.dataset.modelCatIdx = realCatIdx;

            // Header for Model Category
            const header = document.createElement('div');
            header.className = 'cat-header';
            header.innerHTML = `
                <div class="cat-header-left">
                    <svg class="cat-toggle" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                    <span class="cat-name">${esc(cat.name)}</span>
                    <span class="cat-count">${cat.models ? cat.models.length : 0}</span>
                </div>
                <div class="cat-header-right">
                    <button class="btn-icon-action" data-action="edit-model-cat" data-idx="${realCatIdx}" title="Modifica Categoria">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn-icon-action danger" data-action="delete-model-cat" data-idx="${realCatIdx}" title="Elimina Categoria">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>`;

            header.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]')) return;
                card.classList.toggle('open');
            });

            const body = document.createElement('div');
            body.className = 'cat-body';

            const actionsBar = document.createElement('div');
            actionsBar.className = 'cat-actions-bar';
            actionsBar.innerHTML = `
                <span>${cat.models ? cat.models.length : 0} modelli nella categoria</span>
                <button class="btn-icon-action" data-action="add-model" data-cat-idx="${realCatIdx}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Aggiungi Modello
                </button>`;

            const modelsContainer = document.createElement('div');
            modelsContainer.style.display = 'flex';
            modelsContainer.style.flexDirection = 'column';
            modelsContainer.style.gap = '16px';
            modelsContainer.style.padding = '16px 0';

            if (cat.models) {
                cat.models.forEach((model, modIdx) => {
                    const mCard = document.createElement('div');
                    mCard.style.border = '1px solid var(--border)';
                    mCard.style.borderRadius = '8px';
                    mCard.style.background = 'var(--surface-dark)';

                    let baseImgSrc = encodeURI(`${MODELS_IMAGES_BASE}/${model.folder}/${model.base}`);
                    if (model._pendingBaseUpload) {
                        baseImgSrc = 'data:image/png;base64,' + model._pendingBaseUpload.base64;
                    }
                    const fallbackSrc = `https://raw.githubusercontent.com/brilliondiamonds/lebofficonf/main/${encodeURI(MODELS_IMAGES_BASE + '/' + model.folder + '/' + model.base)}?v=${new Date().getTime()}`;

                    const mHeader = document.createElement('div');
                    mHeader.className = 'cat-header';
                    mHeader.style.padding = '12px 16px';
                    mHeader.style.background = 'transparent';
                    mHeader.innerHTML = `
                        <div class="cat-header-left">
                            <img src="${baseImgSrc}" alt="${esc(model.name)}" style="width:30px;height:30px;object-fit:contain;background:#fff;border-radius:4px;" 
                                 onerror="if(!this.dataset.fb){ this.dataset.fb='1'; this.src='${fallbackSrc}'; } else { this.style.display='none'; }"/>
                            <span class="cat-name">${esc(model.name)}</span>
                            <span class="cat-count">${model.masks.length} maschere</span>
                            <span class="cat-folder">${esc(model.folder)}</span>
                        </div>
                        <div class="cat-header-right">
                            <button class="btn-icon-action" data-action="add-mask" data-cat-idx="${realCatIdx}" data-model-idx="${modIdx}" title="Aggiungi Maschera">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="12" y1="5" x2="12" y2="19"/>
                                    <line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                            </button>
                            <button class="btn-icon-action" data-action="edit-model" data-cat-idx="${realCatIdx}" data-model-idx="${modIdx}" title="Modifica Modello">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </button>
                            <button class="btn-icon-action danger" data-action="delete-model" data-cat-idx="${realCatIdx}" data-model-idx="${modIdx}" title="Elimina Modello">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                            </button>
                        </div>`;

                    const mGrid = document.createElement('div');
                    mGrid.className = 'admin-swatch-grid';
                    mGrid.style.padding = '0 16px 16px 16px';
                    mGrid.style.borderTop = '1px solid var(--border)';
                    mGrid.style.marginTop = '12px';

                    if (model.masks.length === 0) {
                        mGrid.style.display = 'none';
                    }

                    model.masks.forEach((mask, maskIdx) => {
                        let maskImgSrc = encodeURI(`${MODELS_IMAGES_BASE}/${model.folder}/${mask.file}`);
                        if (mask._pendingUpload) {
                            maskImgSrc = 'data:image/png;base64,' + mask._pendingUpload.base64;
                        }
                        const maskFbSrc = `https://raw.githubusercontent.com/brilliondiamonds/lebofficonf/main/${encodeURI(MODELS_IMAGES_BASE + '/' + model.folder + '/' + mask.file)}?v=${new Date().getTime()}`;

                        const maskCard = document.createElement('div');
                        maskCard.className = 'admin-swatch-card';
                        maskCard.innerHTML = `
                            <img class="admin-swatch-img" src="${maskImgSrc}" alt="${esc(mask.label)}" loading="lazy" style="background:#fff;"
                                 onerror="if(!this.dataset.fb){ this.dataset.fb='1'; this.src='${maskFbSrc}'; } else { this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%231a1a1f%22 width=%22100%22 height=%22100%22/><text fill=%22%235a5a6a%22 x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2212%22>No img</text></svg>'; }"/>
                            <div class="admin-swatch-info">
                                <span class="admin-swatch-name" title="${esc(mask.label)}">${esc(mask.label)}</span>
                                <button class="admin-swatch-delete" data-action="delete-mask" data-cat-idx="${realCatIdx}" data-model-idx="${modIdx}" data-mask-idx="${maskIdx}" title="Rimuovi">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                </button>
                            </div>`;
                        mGrid.appendChild(maskCard);
                    });

                    mCard.appendChild(mHeader);
                    if (model.masks.length > 0) mCard.appendChild(mGrid);
                    modelsContainer.appendChild(mCard);
                });
            }

            body.appendChild(actionsBar);
            body.appendChild(modelsContainer);
            card.appendChild(header);
            card.appendChild(body);
            modelsList.appendChild(card);
        });
    }

    // ─── ACTION HANDLER ──────────────
    function handleAction(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.action;
        const idx = parseInt(btn.dataset.idx);

        switch (action) {
            case 'edit-cat':
                editingCategoryIndex = idx;
                document.getElementById('modalCategoryTitle').textContent = 'Modifica Categoria';
                document.getElementById('catNameInput').value = materialsData[idx].name;
                document.getElementById('catFolderInput').value = materialsData[idx].folder;
                openModal('modalCategory');
                break;

            case 'delete-cat':
                deletingTarget = { type: 'category', catIdx: idx };
                document.getElementById('deleteMessage').textContent =
                    `Sei sicuro di voler eliminare la categoria "${materialsData[idx].name}" e tutti i suoi ${materialsData[idx].swatches.length} swatch?`;
                openModal('modalDelete');
                break;

            case 'add-swatch':
                editingCategoryIndex = idx;
                pendingSwatchImage = null;
                document.getElementById('swatchLabelInput').value = '';
                document.getElementById('swatchFileInput').value = '';
                document.getElementById('uploadPreview').classList.add('hidden');
                document.getElementById('uploadPlaceholder').classList.remove('hidden');
                openModal('modalSwatch');
                break;

            case 'delete-swatch': {
                const catIdx = parseInt(btn.dataset.catIdx);
                const swIdx = parseInt(btn.dataset.swIdx);
                deletingTarget = { type: 'swatch', catIdx, swIdx };
                document.getElementById('deleteMessage').textContent =
                    `Sei sicuro di voler rimuovere "${materialsData[catIdx].swatches[swIdx].label}"?`;
                openModal('modalDelete');
                break;
            }

            case 'edit-model-cat':
                editingModelCategoryIndex = idx;
                document.getElementById('modalModelCategoryTitle').textContent = 'Modifica Categoria';
                document.getElementById('modelCatNameInput').value = modelsData[idx].name;
                openModal('modalModelCategory');
                break;

            case 'delete-model-cat':
                deletingTarget = { type: 'model-cat', modelCatIdx: idx };
                document.getElementById('deleteMessage').textContent =
                    `Sei sicuro di voler eliminare la categoria "${modelsData[idx].name}" e tutti i suoi ${modelsData[idx].models ? modelsData[idx].models.length : 0} modelli?`;
                openModal('modalDelete');
                break;

            case 'add-model': {
                const catIdx = parseInt(btn.dataset.catIdx);
                editingModelCatParentIndex = catIdx;
                editingModelIndex = -1;
                pendingBaseImage = null;
                document.getElementById('modalModelTitle').textContent = 'Nuovo Modello';
                document.getElementById('modelNameInput').value = '';
                document.getElementById('modelFolderInput').value = '';

                // Populate select
                const sel = document.getElementById('modelCategorySelect');
                sel.innerHTML = modelsData.map((c, i) => `<option value="${i}" ${i === catIdx ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

                const baseInput = document.getElementById('baseFileInput');
                if (baseInput) baseInput.value = '';

                const basePreview = document.getElementById('uploadBasePreview');
                const basePlaceholder = document.getElementById('uploadBasePlaceholder');
                if (basePreview) basePreview.classList.add('hidden');
                if (basePlaceholder) basePlaceholder.classList.remove('hidden');

                openModal('modalModel');
                break;
            }

            case 'edit-model': {
                const catIdx = parseInt(btn.dataset.catIdx);
                const modIdx = parseInt(btn.dataset.modelIdx);
                editingModelCatParentIndex = catIdx;
                editingModelIndex = modIdx;
                pendingBaseImage = null;

                const theModel = modelsData[catIdx].models[modIdx];
                document.getElementById('modalModelTitle').textContent = 'Modifica Modello';
                document.getElementById('modelNameInput').value = theModel.name;
                document.getElementById('modelFolderInput').value = theModel.folder;

                // Populate select
                const sel = document.getElementById('modelCategorySelect');
                sel.innerHTML = modelsData.map((c, i) => `<option value="${i}" ${i === catIdx ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

                const baseInput = document.getElementById('baseFileInput');
                if (baseInput) baseInput.value = '';

                const basePreview = document.getElementById('uploadBasePreview');
                const basePlaceholder = document.getElementById('uploadBasePlaceholder');
                if (theModel._pendingBaseUpload) {
                    basePreview.src = 'data:image/png;base64,' + theModel._pendingBaseUpload.base64;
                    basePreview.classList.remove('hidden');
                    basePlaceholder.classList.add('hidden');
                } else if (theModel.base) {
                    basePreview.src = encodeURI(`${MODELS_IMAGES_BASE}/${theModel.folder}/${theModel.base}`);
                    basePreview.classList.remove('hidden');
                    basePlaceholder.classList.add('hidden');
                } else {
                    basePreview.classList.add('hidden');
                    basePlaceholder.classList.remove('hidden');
                }
                openModal('modalModel');
                break;
            }

            case 'delete-model': {
                const catIdx = parseInt(btn.dataset.catIdx);
                const modIdx = parseInt(btn.dataset.modelIdx);
                deletingTarget = { type: 'model', modelCatIdx: catIdx, modelIdx: modIdx };
                document.getElementById('deleteMessage').textContent =
                    `Sei sicuro di voler eliminare il modello "${modelsData[catIdx].models[modIdx].name}"?`;
                openModal('modalDelete');
                break;
            }

            case 'add-mask': {
                const catIdx = parseInt(btn.dataset.catIdx);
                const modIdx = parseInt(btn.dataset.modelIdx);
                editingModelCatParentIndex = catIdx;
                editingModelIndex = modIdx;
                pendingMaskImage = null;
                document.getElementById('maskLabelInput').value = '';
                const maskInput = document.getElementById('maskFileInput');
                if (maskInput) maskInput.value = '';
                const maskPreview = document.getElementById('uploadMaskPreview');
                const maskPlaceholder = document.getElementById('uploadMaskPlaceholder');
                if (maskPreview) maskPreview.classList.add('hidden');
                if (maskPlaceholder) maskPlaceholder.classList.remove('hidden');
                openModal('modalMask');
                break;
            }

            case 'delete-mask': {
                const catIdx = parseInt(btn.dataset.catIdx);
                const modIdx = parseInt(btn.dataset.modelIdx);
                const maskIdx = parseInt(btn.dataset.maskIdx);
                deletingTarget = { type: 'mask', modelCatIdx: catIdx, modelIdx: modIdx, maskIdx: maskIdx };
                document.getElementById('deleteMessage').textContent =
                    `Sei sicuro di voler rimuovere "${modelsData[catIdx].models[modIdx].masks[maskIdx].label}"?`;
                openModal('modalDelete');
                break;
            }
        }
    }

    // ─── DRAG & DROP HELPER ──────────
    function handleDropItems(draggedData, targetCatIdx, targetSwIdx) {
        let itemsToMove = [];

        // 1. Sort effectively: highest index first to avoid disrupting later removals
        draggedData.sort((a, b) => {
            if (a.catIdx !== b.catIdx) return b.catIdx - a.catIdx;
            return b.swIdx - a.swIdx;
        });

        // 2. Remove items from original arrays
        draggedData.forEach(item => {
            const removed = materialsData[item.catIdx].swatches.splice(item.swIdx, 1)[0];
            // Push to front so they stay in their original relative order
            itemsToMove.unshift(removed);

            // se stavamo eliminando dallo stesso blocco di destinazione E prima del target inserimento, il target inserimento scende
            if (item.catIdx === targetCatIdx && item.swIdx < targetSwIdx) {
                targetSwIdx--;
            }
        });

        // 3. Insert into the new location
        materialsData[targetCatIdx].swatches.splice(targetSwIdx, 0, ...itemsToMove);

        updateStatus();
        renderCategories();

        // Attempt to re-select the moved swatches
        setTimeout(() => {
            const cards = document.querySelectorAll('.admin-swatch-card');
            cards.forEach(card => {
                const cIdx = parseInt(card.dataset.catIdx);
                const sIdx = parseInt(card.dataset.swIdx);
                if (cIdx === targetCatIdx && sIdx >= targetSwIdx && sIdx < targetSwIdx + itemsToMove.length) {
                    card.classList.add('selected');
                }
            });
        }, 10);
    }

    // ─── CATEGORY CRUD ───────────────
    function confirmCategory() {
        const name = document.getElementById('catNameInput').value.trim();
        const folder = document.getElementById('catFolderInput').value.trim();

        if (!name || !folder) {
            showToast('Compila tutti i campi', 'error');
            return;
        }

        if (editingCategoryIndex >= 0) {
            // Edit existing
            materialsData[editingCategoryIndex].name = name;
            materialsData[editingCategoryIndex].folder = folder;
            // Update ID from name
            materialsData[editingCategoryIndex].id = slugify(name);
        } else {
            // Add new
            materialsData.push({
                id: slugify(name),
                name: name,
                folder: folder,
                swatches: []
            });
        }

        closeModal('modalCategory');
        renderCategories();
        updateStatus();
        showToast(editingCategoryIndex >= 0 ? 'Categoria aggiornata' : 'Categoria aggiunta', 'success');
    }

    // ─── SWATCH CRUD ─────────────────
    function confirmSwatch() {
        const label = document.getElementById('swatchLabelInput').value.trim();

        if (!label) {
            showToast('Inserisci un nome per lo swatch', 'error');
            return;
        }

        if (!pendingSwatchImage) {
            showToast('Seleziona un\'immagine', 'error');
            return;
        }

        const cat = materialsData[editingCategoryIndex];
        cat.swatches.push({
            file: pendingSwatchImage.fileName,
            label: label,
            _pendingUpload: {
                base64: pendingSwatchImage.base64,
                folder: cat.folder
            }
        });

        closeModal('modalSwatch');
        renderCategories();
        updateStatus();
        showToast('Swatch aggiunto (sarà caricato al salvataggio)', 'success');
    }

    // ─── MODEL CATEGORY CRUD ─────────
    function confirmModelCategory() {
        const name = document.getElementById('modelCatNameInput').value.trim();

        if (!name) {
            showToast('Inserisci un nome per la categoria', 'error');
            return;
        }

        if (editingModelCategoryIndex >= 0) {
            // Edit existing
            modelsData[editingModelCategoryIndex].name = name;
            modelsData[editingModelCategoryIndex].id = slugify(name);
        } else {
            // Add new
            modelsData.push({
                id: slugify(name),
                name: name,
                models: []
            });
        }

        closeModal('modalModelCategory');
        renderModels();
        updateStatus();
        showToast(editingModelCategoryIndex >= 0 ? 'Categoria modelli aggiornata' : 'Categoria modelli aggiunta', 'success');
    }

    // ─── MODEL CRUD ──────────────────
    function confirmModel() {
        const name = document.getElementById('modelNameInput').value.trim();
        const folder = document.getElementById('modelFolderInput').value.trim();
        const selectCat = document.getElementById('modelCategorySelect');
        const selectedCatIdx = parseInt(selectCat.value);

        if (!name || !folder || isNaN(selectedCatIdx)) {
            showToast('Compila tutti i campi', 'error');
            return;
        }

        if (editingModelIndex >= 0 && editingModelCatParentIndex >= 0) {
            const theModel = modelsData[editingModelCatParentIndex].models[editingModelIndex];
            theModel.name = name;
            theModel.folder = folder;
            theModel.id = slugify(name);
            if (pendingBaseImage) {
                theModel.base = pendingBaseImage.fileName;
                theModel._pendingBaseUpload = {
                    base64: pendingBaseImage.base64,
                    folder: folder
                };
            }

            // If category changed, move it
            if (selectedCatIdx !== editingModelCatParentIndex) {
                modelsData[editingModelCatParentIndex].models.splice(editingModelIndex, 1);
                if (!modelsData[selectedCatIdx].models) modelsData[selectedCatIdx].models = [];
                modelsData[selectedCatIdx].models.push(theModel);
            }
        } else {
            if (!pendingBaseImage) {
                showToast('Seleziona un\'immagine di base', 'error');
                return;
            }
            if (!modelsData[selectedCatIdx].models) modelsData[selectedCatIdx].models = [];
            modelsData[selectedCatIdx].models.push({
                id: slugify(name),
                name: name,
                folder: folder,
                base: pendingBaseImage.fileName,
                _pendingBaseUpload: {
                    base64: pendingBaseImage.base64,
                    folder: folder
                },
                masks: []
            });
        }

        closeModal('modalModel');
        renderModels();
        updateStatus();
        showToast(editingModelIndex >= 0 ? 'Modello aggiornato' : 'Modello aggiunto', 'success');
    }

    // ─── MASK CRUD ───────────────────
    function confirmMask() {
        const label = document.getElementById('maskLabelInput').value.trim();

        if (!label) {
            showToast('Inserisci un nome per la maschera', 'error');
            return;
        }

        if (!pendingMaskImage) {
            showToast('Seleziona un\'immagine per la maschera', 'error');
            return;
        }

        const model = modelsData[editingModelCatParentIndex].models[editingModelIndex];
        if (!model.masks) model.masks = [];
        model.masks.push({
            file: pendingMaskImage.fileName,
            label: label,
            _pendingUpload: {
                base64: pendingMaskImage.base64,
                folder: model.folder
            }
        });

        closeModal('modalMask');
        renderModels();
        updateStatus();
        showToast('Maschera aggiunta (sarà caricata al salvataggio)', 'success');
    }

    // ─── DELETE ──────────────────────
    function confirmDelete() {
        if (!deletingTarget) return;

        if (deletingTarget.type === 'category') {
            const removed = materialsData.splice(deletingTarget.catIdx, 1)[0];
            showToast(`Categoria "${removed.name}" rimossa`, 'success');
        } else if (deletingTarget.type === 'swatch') {
            const cat = materialsData[deletingTarget.catIdx];
            const removed = cat.swatches.splice(deletingTarget.swIdx, 1)[0];
            showToast(`Swatch "${removed.label}" rimosso`, 'success');
        } else if (deletingTarget.type === 'model-cat') {
            const removed = modelsData.splice(deletingTarget.modelCatIdx, 1)[0];
            showToast(`Categoria modelli "${removed.name}" rimossa`, 'success');
        } else if (deletingTarget.type === 'model') {
            const removed = modelsData[deletingTarget.modelCatIdx].models.splice(deletingTarget.modelIdx, 1)[0];
            showToast(`Modello "${removed.name}" rimosso`, 'success');
        } else if (deletingTarget.type === 'mask') {
            const model = modelsData[deletingTarget.modelCatIdx].models[deletingTarget.modelIdx];
            const removed = model.masks.splice(deletingTarget.maskIdx, 1)[0];
            showToast(`Maschera "${removed.label}" rimossa`, 'success');
        }

        deletingTarget = null;
        closeModal('modalDelete');
        if (currentTab === 'materiali') {
            renderCategories();
        } else {
            renderModels();
        }
        updateStatus();
    }

    // ─── SAVE & PUBLISH ──────────────
    async function saveAndPublish() {
        const btn = document.getElementById('btnSavePublish');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Pubblicazione…`;
        setStatus('saving', 'Pubblicazione…');

        try {
            // 1. Upload any pending swatch images
            const pendingUploads = [];
            materialsData.forEach(cat => {
                cat.swatches.forEach(sw => {
                    if (sw._pendingUpload) {
                        pendingUploads.push({
                            path: `${IMAGES_BASE}/${sw._pendingUpload.folder}/${sw.file}`,
                            base64: sw._pendingUpload.base64,
                            label: sw.label
                        });
                    }
                });
            });

            for (const upload of pendingUploads) {
                setStatus('saving', `Caricamento ${upload.label}…`);
                await uploadImage(
                    upload.path,
                    upload.base64,
                    `[Admin] Aggiunta immagine: ${upload.label}`
                );
            }

            // 2. Clean pending flags from data
            const cleanData = materialsData.map(cat => ({
                id: cat.id,
                name: cat.name,
                folder: cat.folder,
                swatches: cat.swatches.map(sw => ({
                    file: sw.file,
                    label: sw.label
                }))
            }));

            // 3. Commit materials.json
            setStatus('saving', 'Salvataggio materials.json…');
            const jsonContent = JSON.stringify(cleanData, null, 4);
            const result = await commitFile(
                MATERIALS_PATH,
                jsonContent,
                `[Admin] Aggiornamento materiali (${new Date().toLocaleString('it-IT')})`,
                fileSha
            );

            // 4. Update local state
            fileSha = result.content.sha;
            materialsData = cleanData;
            originalJSON = JSON.stringify(materialsData);

            renderCategories();
            updateStatus();
            showToast('✅ Pubblicato con successo! Vercel farà il redeploy automaticamente.', 'success');
        } catch (err) {
            showToast('❌ Errore: ' + err.message, 'error');
            setStatus('unsaved', 'Modifiche non salvate');
        } finally {
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Salva e Pubblica`;
            updateStatus();
        }
    }

    // ─── SAVE & PUBLISH MODELLI ──────
    async function saveAndPublishModels() {
        const btn = document.getElementById('btnSavePublishModelli');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Pubblicazione…`;
        setStatus('saving', 'Pubblicazione…');

        try {
            const pendingUploads = [];
            modelsData.forEach(cat => {
                if (cat.models) {
                    cat.models.forEach(m => {
                        if (m._pendingBaseUpload) {
                            pendingUploads.push({
                                path: `${MODELS_IMAGES_BASE}/${m._pendingBaseUpload.folder}/${m.base}`,
                                base64: m._pendingBaseUpload.base64,
                                label: `Base: ${m.name}`
                            });
                        }
                        if (m.masks) {
                            m.masks.forEach(mask => {
                                if (mask._pendingUpload) {
                                    pendingUploads.push({
                                        path: `${MODELS_IMAGES_BASE}/${mask._pendingUpload.folder}/${mask.file}`,
                                        base64: mask._pendingUpload.base64,
                                        label: `Maschera: ${mask.label}`
                                    });
                                }
                            });
                        }
                    });
                }
            });

            for (const upload of pendingUploads) {
                setStatus('saving', `Caricamento ${upload.label}…`);
                await uploadImage(
                    upload.path,
                    upload.base64,
                    `[Admin] Aggiunta immagine: ${upload.label}`
                );
            }

            const cleanData = modelsData.map(cat => ({
                id: cat.id,
                name: cat.name,
                models: (cat.models || []).map(m => ({
                    id: m.id,
                    name: m.name,
                    folder: m.folder,
                    base: m.base,
                    masks: (m.masks || []).map(mask => ({
                        file: mask.file,
                        label: mask.label
                    }))
                }))
            }));

            setStatus('saving', 'Salvataggio models.json…');
            const jsonContent = JSON.stringify(cleanData, null, 4);
            const result = await commitFile(
                MODELS_PATH,
                jsonContent,
                `[Admin] Aggiornamento modelli (${new Date().toLocaleString('it-IT')})`,
                modelsFileSha
            );

            modelsFileSha = result.content.sha;
            modelsData = cleanData;
            originalModelsJSON = JSON.stringify(modelsData);

            renderModels();
            updateStatus();
            showToast('✅ Pubblicato con successo! Vercel farà il redeploy automaticamente.', 'success');
        } catch (err) {
            showToast('❌ Errore: ' + err.message, 'error');
            setStatus('unsaved', 'Modifiche non salvate');
        } finally {
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Salva e Pubblica Modelli`;
            updateStatus();
        }
    }

    // ─── STATUS TRACKING ─────────────
    function hasChanges() {
        const currentCleanMaterials = materialsData.map(cat => ({
            id: cat.id,
            name: cat.name,
            folder: cat.folder,
            swatches: cat.swatches.map(sw => ({
                file: sw.file,
                label: sw.label
            }))
        }));
        const matChanged = JSON.stringify(currentCleanMaterials) !== originalJSON;

        const currentCleanModels = modelsData.map(cat => ({
            id: cat.id,
            name: cat.name,
            models: (cat.models || []).map(m => ({
                id: m.id,
                name: m.name,
                folder: m.folder,
                base: m.base,
                masks: (m.masks || []).map(mask => ({
                    file: mask.file,
                    label: mask.label
                }))
            }))
        }));
        const modChanged = JSON.stringify(currentCleanModels) !== originalModelsJSON;

        return { matChanged, modChanged };
    }

    function updateStatus() {
        const { matChanged, modChanged } = hasChanges();

        const btnMat = document.getElementById('btnSavePublish');
        if (btnMat) btnMat.disabled = !matChanged;

        const btnMod = document.getElementById('btnSavePublishModelli');
        if (btnMod) btnMod.disabled = !modChanged;

        if (matChanged || modChanged) {
            setStatus('unsaved', 'Modifiche non salvate');
        } else {
            setStatus('synced', 'Sincronizzato');
        }
    }

    function setStatus(type, text) {
        statusBadge.textContent = text;
        statusBadge.className = 'status-badge';
        if (type === 'unsaved') statusBadge.classList.add('unsaved');
        if (type === 'saving') statusBadge.classList.add('saving');
    }

    // ─── FILE UPLOAD ─────────────────
    function setupUploadArea() {
        const uploadConfigs = [
            {
                areaId: 'uploadArea',
                inputId: 'swatchFileInput',
                previewId: 'uploadPreview',
                placeholderId: 'uploadPlaceholder',
                onFileRead: (base64Data, fileName) => {
                    pendingSwatchImage = { base64: base64Data, fileName: fileName };
                }
            },
            {
                areaId: 'uploadBaseArea', // assume this is the id, wait let me check if it exists
                inputId: 'baseFileInput',
                previewId: 'uploadBasePreview',
                placeholderId: 'uploadBasePlaceholder',
                onFileRead: (base64Data, fileName) => {
                    pendingBaseImage = { base64: base64Data, fileName: fileName };
                }
            },
            {
                areaId: 'uploadMaskArea', // assume this is the id
                inputId: 'maskFileInput',
                previewId: 'uploadMaskPreview',
                placeholderId: 'uploadMaskPlaceholder',
                onFileRead: (base64Data, fileName) => {
                    pendingMaskImage = { base64: base64Data, fileName: fileName };
                }
            }
        ];

        uploadConfigs.forEach(config => {
            const area = document.getElementById(config.areaId) || document.getElementById(config.inputId)?.closest('.upload-area');
            const fileInput = document.getElementById(config.inputId);
            const preview = document.getElementById(config.previewId);
            const placeholder = document.getElementById(config.placeholderId);

            if (!area || !fileInput) return;

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) processFile(file, config, preview, placeholder);
            });

            area.addEventListener('dragover', (e) => {
                e.preventDefault();
                area.classList.add('dragover');
            });

            area.addEventListener('dragleave', () => {
                area.classList.remove('dragover');
            });

            area.addEventListener('drop', (e) => {
                e.preventDefault();
                area.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    processFile(file, config, preview, placeholder);
                }
            });
        });

        function processFile(file, config, preview, placeholder) {
            const reader = new FileReader();
            reader.onload = () => {
                const base64Full = reader.result;
                const base64Data = base64Full.split(',')[1];
                config.onFileRead(base64Data, file.name);
                preview.src = base64Full;
                preview.classList.remove('hidden');
                placeholder.classList.add('hidden');
            };
            reader.readAsDataURL(file);
        }
    }

    // ─── MODALS ──────────────────────
    function openModal(id) {
        document.getElementById(id).classList.remove('hidden');
    }

    function closeModal(id) {
        document.getElementById(id).classList.add('hidden');
    }

    // ─── TOAST ───────────────────────
    function showToast(msg, type = 'info') {
        toast.textContent = msg;
        toast.className = 'toast ' + type;
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3500);
    }

    // ─── HELPERS ─────────────────────
    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function slugify(text) {
        return text.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    // ─── BOOT ────────────────────────
    document.addEventListener('DOMContentLoaded', init);
})();
