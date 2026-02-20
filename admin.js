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
    const IMAGES_BASE = 'images/materiali';
    const MODELS_PATH = 'models.json';
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

    let activeTab = 'materials';

    let pendingImages = []; // For storing extra pending images (base or masks) safely
    let pendingSwatchImage = null; // { base64, fileName }

    let editingCategoryIndex = -1;
    let editingModelIndex = -1; // Track model index
    let deletingTarget = null; // { type: 'category'|'swatch'|'modelCat'|'model'|'mask', catIdx, swIdx?, modIdx?, maskIdx? }

    // ─── DOM REFS ────────────────────
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    const tokenInput = document.getElementById('tokenInput');
    const loginError = document.getElementById('loginError');
    const categoriesList = document.getElementById('categoriesList');
    const modelsList = document.getElementById('modelsList');
    const statusBadge = document.getElementById('statusBadge');
    const itemCount = document.getElementById('itemCount');
    const repoInfo = document.getElementById('repoInfo');
    const searchInput = document.getElementById('searchInput');
    const toast = document.getElementById('toast');

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

        // Add category / model category
        document.getElementById('btnAddCategory').addEventListener('click', () => {
            editingCategoryIndex = -1;
            document.getElementById('catNameInput').value = '';
            // We no longer use catFolderInput
            if (activeTab === 'materials') {
                document.getElementById('modalCategoryTitle').textContent = 'Nuova Categoria';
            } else {
                document.getElementById('modalCategoryTitle').textContent = 'Nuova Categoria Modelli';
            }
            openModal('modalCategory');
        });

        // Tabs
        document.querySelectorAll('.admin-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                activeTab = e.target.dataset.tab;

                if (activeTab === 'materials') {
                    categoriesList.classList.remove('hidden');
                    modelsList.classList.add('hidden');
                    document.getElementById('btnAddCategoryLabel').textContent = 'Nuova Categoria';
                    searchInput.placeholder = 'Cerca materiale…';
                    renderCategories();
                } else {
                    categoriesList.classList.add('hidden');
                    modelsList.classList.remove('hidden');
                    document.getElementById('btnAddCategoryLabel').textContent = 'Nuova Categoria Modelli';
                    searchInput.placeholder = 'Cerca modello…';
                    renderModels();
                }
            });
        });

        // Confirm category
        document.getElementById('btnConfirmCategory').addEventListener('click', confirmCategory);

        // Confirm swatch / mask / model
        document.getElementById('btnConfirmSwatch').addEventListener('click', confirmSwatch);

        // Confirm delete
        document.getElementById('btnConfirmDelete').addEventListener('click', confirmDelete);

        // Save & Publish
        document.getElementById('btnSavePublish').addEventListener('click', saveAndPublish);

        // Search
        searchInput.addEventListener('input', () => {
            if (activeTab === 'materials') renderCategories();
            else renderModels();
        });

        // Modal close buttons
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => closeModal(btn.dataset.close));
        });

        // Upload area interactions
        setupUploadArea();

        // Delegate action buttons
        categoriesList.addEventListener('click', handleAction);
        modelsList.addEventListener('click', handleAction);

        // Auto-login if token exists
        if (saved) doLogin();
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
            const user = await res.json();
            token = t;
            localStorage.setItem('leboffi_gh_token', t);

            // Check repo write permissions
            const repoRes = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}`);
            let hasPush = false;
            if (repoRes.ok) {
                const repoData = await repoRes.json();
                hasPush = repoData.permissions && repoData.permissions.push;
                repoInfo.textContent = `${REPO_OWNER}/${REPO_NAME} · ${user.login}`;
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

        try {
            // Load materials
            const resMat = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${MATERIALS_PATH}`);
            if (!resMat.ok) throw new Error('Impossibile caricare materials.json');
            const dataMat = await resMat.json();
            fileSha = dataMat.sha;
            materialsData = JSON.parse(atob(dataMat.content.replace(/\n/g, '')));
            originalJSON = JSON.stringify(materialsData);

            // Load models
            let dataModText = '';
            try {
                const resMod = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${MODELS_PATH}`);
                if (resMod.ok) {
                    const dataMod = await resMod.json();
                    modelsFileSha = dataMod.sha;
                    dataModText = atob(dataMod.content.replace(/\n/g, ''));
                }
            } catch (err) { }

            if (dataModText) {
                modelsData = JSON.parse(dataModText);
            } else {
                modelsData = [];
            }
            originalModelsJSON = JSON.stringify(modelsData);

            if (activeTab === 'materials') renderCategories();
            else renderModels();

            updateStatus();
        } catch (err) {
            categoriesList.innerHTML = `<p style="text-align:center;color:var(--danger);padding:40px;">❌ ${err.message}</p>`;
            modelsList.innerHTML = `<p style="text-align:center;color:var(--danger);padding:40px;">❌ ${err.message}</p>`;
        }
    }

    async function commitFile(path, content, message, sha) {
        const body = {
            message: message,
            content: btoa(unescape(encodeURIComponent(content))),
            sha: sha
        };
        const res = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const err = await res.json();
            console.error('[Admin] Commit error:', res.status, err);
            if (res.status === 404) {
                throw new Error('Nessun permesso di scrittura. Il token deve appartenere al proprietario del repo oppure a un collaboratore con permesso "Write".');
            }
            throw new Error(err.message || 'Errore nel commit (HTTP ' + res.status + ')');
        }
        return res.json();
    }

    async function uploadImage(path, base64Data, message) {
        // Check if file exists
        let sha = undefined;
        try {
            const check = await ghFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`);
            if (check.ok) {
                const existing = await check.json();
                sha = existing.sha;
            }
        } catch (e) { /* file doesn't exist, that's fine */ }

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
            const err = await res.json();
            throw new Error(err.message || 'Errore upload immagine');
        }
        return res.json();
    }

    // ─── RENDER ──────────────────────
    function renderCategories() {
        const query = searchInput.value.trim().toLowerCase();
        categoriesList.innerHTML = '';

        let filtered = materialsData;
        if (query) {
            filtered = materialsData.filter(cat =>
                cat.name.toLowerCase().includes(query) ||
                cat.swatches.some(sw => sw.label.toLowerCase().includes(query))
            );
        }

        const total = materialsData.reduce((sum, c) => sum + (c.swatches ? c.swatches.length : 0), 0);
        itemCount.textContent = `${materialsData.length} categorie · ${total} swatch`;

        if (filtered.length === 0) {
            categoriesList.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:40px;">Nessun risultato</p>`;
            return;
        }

        filtered.forEach((cat, filteredIdx) => {
            const realIdx = materialsData.indexOf(cat);
            const card = document.createElement('div');
            card.className = 'category-card';
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
                const imgSrc = encodeURI(`${IMAGES_BASE}/${cat.folder}/${sw.file}`);
                const swCard = document.createElement('div');
                swCard.className = 'admin-swatch-card';
                swCard.innerHTML = `
                    <img class="admin-swatch-img" src="${imgSrc}" alt="${esc(sw.label)}" loading="lazy" 
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%231a1a1f%22 width=%22100%22 height=%22100%22/><text fill=%22%235a5a6a%22 x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2212%22>No img</text></svg>'"/>
                    <div class="admin-swatch-info">
                        <span class="admin-swatch-name" title="${esc(sw.label)}">${esc(sw.label)}</span>
                        <button class="admin-swatch-delete" data-action="delete-swatch" data-cat-idx="${realIdx}" data-sw-idx="${swIdx}" title="Rimuovi">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>`;
                grid.appendChild(swCard);
            });

            body.appendChild(actionsBar);
            body.appendChild(grid);
            card.appendChild(header);
            card.appendChild(body);
            categoriesList.appendChild(card);
        });
    }

    function renderModels() {
        const query = searchInput.value.trim().toLowerCase();
        modelsList.innerHTML = '';

        let filtered = modelsData;
        if (query) {
            filtered = modelsData.filter(cat =>
                cat.name.toLowerCase().includes(query) ||
                (cat.models && cat.models.some(m => m.name.toLowerCase().includes(query) || (m.masks && m.masks.some(mk => mk.label.toLowerCase().includes(query)))))
            );
        }

        let totalModels = 0;
        modelsData.forEach(c => totalModels += (c.models ? c.models.length : 0));
        itemCount.textContent = `${modelsData.length} categorie · ${totalModels} modelli`;

        if (filtered.length === 0) {
            modelsList.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:40px;">Nessun risultato</p>`;
            return;
        }

        filtered.forEach((cat, filteredIdx) => {
            const realIdx = modelsData.indexOf(cat);
            const card = document.createElement('div');
            card.className = 'category-card';
            card.dataset.idx = realIdx;

            const modelsCount = cat.models ? cat.models.length : 0;

            const header = document.createElement('div');
            header.className = 'cat-header';
            header.innerHTML = `
                <div class="cat-header-left">
                    <svg class="cat-toggle" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                    <span class="cat-name">${esc(cat.name)}</span>
                    <span class="cat-count">${modelsCount}</span>
                </div>
                <div class="cat-header-right">
                    <button class="btn-icon-action" data-action="edit-model-cat" data-idx="${realIdx}" title="Modifica Categoria">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn-icon-action danger" data-action="delete-model-cat" data-idx="${realIdx}" title="Elimina Categoria">
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
                <span>${modelsCount} modelli nella categoria</span>
                <button class="btn-icon-action" data-action="add-model" data-idx="${realIdx}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Aggiungi Modello
                </button>`;

            const grid = document.createElement('div');
            grid.className = 'admin-swatch-grid';

            if (cat.models) {
                cat.models.forEach((mod, modIdx) => {
                    const imgSrc = mod._pendingBaseUpload ? mod._pendingBaseUpload.base64Full : encodeURI(`${MODELS_IMAGES_BASE}/${mod.folder}/${mod.base}`);
                    const mCard = document.createElement('div');
                    mCard.className = 'admin-swatch-card';
                    mCard.style.gridColumn = 'span 2'; // make model cards wider

                    let masksHtml = '';
                    if (mod.masks) {
                        mod.masks.forEach((mk, mkIdx) => {
                            const maskSrc = mk._pendingUpload ? mk._pendingUpload.base64Full : encodeURI(`${MODELS_IMAGES_BASE}/${mod.folder}/${mk.file}`);
                            masksHtml += `
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; padding:6px; background:rgba(255,255,255,0.05); border-radius:4px; border:1px solid var(--border);">
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <img src="${maskSrc}" style="width:24px; height:24px; object-fit:contain; background:#111; border-radius:2px;" />
                                    <span title="${esc(mk.label)}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px; font-size:12px;">${esc(mk.label)}</span>
                                </div>
                                <button data-action="delete-mask" data-cat-idx="${realIdx}" data-mod-idx="${modIdx}" data-mask-idx="${mkIdx}" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:2px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>`;
                        });
                    }

                    mCard.innerHTML = `
                        <img class="admin-swatch-img" src="${imgSrc}" alt="${esc(mod.name)}" loading="lazy" 
                             style="max-height:160px; object-fit:contain; background:#111; padding:8px;"
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%231a1a1f%22 width=%22100%22 height=%22100%22/><text fill=%22%235a5a6a%22 x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2212%22>No img</text></svg>'"/>
                        <div class="admin-swatch-info" style="flex-direction:column; align-items:stretch;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <div style="display:flex; flex-direction:column;">
                                    <span class="admin-swatch-name" style="font-size:14px;" title="${esc(mod.name)}"><b>${esc(mod.name)}</b></span>
                                    <span style="font-size:10px; color:var(--text-dim); font-family:monospace;">${esc(mod.folder)}</span>
                                </div>
                                <button class="admin-swatch-delete" data-action="delete-model" data-cat-idx="${realIdx}" data-mod-idx="${modIdx}" title="Rimuovi Modello">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                </button>
                            </div>
                            <div style="font-size:11px; color:var(--text-muted);">
                                <div style="font-weight:600; text-transform:uppercase; font-size:10px; margin-bottom:4px; letter-spacing:0.5px;">Maschere associate</div>
                                ${masksHtml || '<div style="padding:6px; font-style:italic; opacity:0.6;">Nessuna maschera</div>'}
                                <button class="btn-icon-action" style="width:100%; margin-top:8px; justify-content:center; padding:6px;" data-action="add-mask" data-cat-idx="${realIdx}" data-mod-idx="${modIdx}">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    Aggiungi Maschera
                                </button>
                            </div>
                        </div>`;
                    grid.appendChild(mCard);
                });
            }

            body.appendChild(actionsBar);
            body.appendChild(grid);
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
                document.getElementById('catFolderGroup').classList.remove('hidden');
                openModal('modalCategory');
                break;
            case 'edit-model-cat':
                editingCategoryIndex = idx;
                document.getElementById('modalCategoryTitle').textContent = 'Modifica Categoria Modelli';
                document.getElementById('catNameInput').value = modelsData[idx].name;
                document.getElementById('catFolderGroup').classList.add('hidden');
                openModal('modalCategory');
                break;

            case 'delete-cat':
                deletingTarget = { type: 'category', catIdx: idx };
                document.getElementById('deleteMessage').textContent =
                    `Sei sicuro di voler eliminare la categoria "${materialsData[idx].name}" e tutti i suoi swatch?`;
                openModal('modalDelete');
                break;
            case 'delete-model-cat':
                deletingTarget = { type: 'modelCat', catIdx: idx };
                document.getElementById('deleteMessage').textContent =
                    `Sei sicuro di voler eliminare la categoria "${modelsData[idx].name}" e tutti i suoi modelli?`;
                openModal('modalDelete');
                break;

            case 'add-swatch':
                editingCategoryIndex = idx;
                editingModelIndex = -1;
                pendingSwatchImage = null;
                document.getElementById('modalSwatchTitle').textContent = 'Aggiungi Swatch';
                document.getElementById('swatchLabelTitle').textContent = 'Nome Swatch';
                document.getElementById('swatchLabelInput').value = '';
                document.getElementById('modelExtraFields').classList.add('hidden');
                document.getElementById('swatchFileInput').value = '';
                document.getElementById('uploadPreview').classList.add('hidden');
                document.getElementById('uploadPlaceholder').classList.remove('hidden');
                openModal('modalSwatch');
                break;
            case 'add-model':
                editingCategoryIndex = idx;
                editingModelIndex = -1;
                pendingSwatchImage = null;
                document.getElementById('modalSwatchTitle').textContent = 'Aggiungi Modello';
                document.getElementById('swatchLabelTitle').textContent = 'Nome Modello';
                document.getElementById('swatchLabelInput').value = '';
                document.getElementById('modelExtraFields').classList.remove('hidden');
                document.getElementById('modelFolderInput').value = '';
                document.getElementById('uploadImageTitle').textContent = 'Immagine Base';
                document.getElementById('swatchFileInput').value = '';
                document.getElementById('uploadPreview').classList.add('hidden');
                document.getElementById('uploadPlaceholder').classList.remove('hidden');
                openModal('modalSwatch');
                break;
            case 'add-mask':
                editingCategoryIndex = parseInt(btn.dataset.catIdx);
                editingModelIndex = parseInt(btn.dataset.modIdx);
                pendingSwatchImage = null;
                document.getElementById('modalSwatchTitle').textContent = 'Aggiungi Maschera';
                document.getElementById('swatchLabelTitle').textContent = 'Nome Maschera';
                document.getElementById('swatchLabelInput').value = '';
                document.getElementById('modelExtraFields').classList.add('hidden');
                document.getElementById('uploadImageTitle').textContent = 'Immagine Maschera';
                document.getElementById('swatchFileInput').value = '';
                document.getElementById('uploadPreview').classList.add('hidden');
                document.getElementById('uploadPlaceholder').classList.remove('hidden');
                openModal('modalSwatch');
                break;

            case 'delete-swatch':
                deletingTarget = { type: 'swatch', catIdx: parseInt(btn.dataset.catIdx), swIdx: parseInt(btn.dataset.swIdx) };
                document.getElementById('deleteMessage').textContent = `Sei sicuro di voler rimuovere lo swatch?`;
                openModal('modalDelete');
                break;
            case 'delete-model':
                deletingTarget = { type: 'model', catIdx: parseInt(btn.dataset.catIdx), modIdx: parseInt(btn.dataset.modIdx) };
                document.getElementById('deleteMessage').textContent = `Sei sicuro di voler rimuovere il modello?`;
                openModal('modalDelete');
                break;
            case 'delete-mask':
                deletingTarget = { type: 'mask', catIdx: parseInt(btn.dataset.catIdx), modIdx: parseInt(btn.dataset.modIdx), maskIdx: parseInt(btn.dataset.maskIdx) };
                document.getElementById('deleteMessage').textContent = `Sei sicuro di voler rimuovere la maschera?`;
                openModal('modalDelete');
                break;
        }
    }

    // ─── CATEGORY CRUD ───────────────
    function confirmCategory() {
        const name = document.getElementById('catNameInput').value.trim();
        const folder = slugify(name); // Auto-generate folder from name

        if (activeTab === 'materials') {
            if (!name) { showToast('Compila il nome', 'error'); return; }
            if (editingCategoryIndex >= 0) {
                materialsData[editingCategoryIndex].name = name;
                materialsData[editingCategoryIndex].folder = folder;
                materialsData[editingCategoryIndex].id = slugify(name);
            } else {
                materialsData.push({ id: slugify(name), name: name, folder: folder, swatches: [] });
            }
            renderCategories();
        } else {
            if (!name) { showToast('Compila il nome', 'error'); return; }
            if (editingCategoryIndex >= 0) {
                modelsData[editingCategoryIndex].name = name;
                modelsData[editingCategoryIndex].id = slugify(name);
            } else {
                modelsData.push({ id: slugify(name), name: name, models: [] });
            }
            renderModels();
        }

        closeModal('modalCategory');
        updateStatus();
        showToast('Categoria salvata', 'success');
    }

    // ─── SWATCH CRUD ─────────────────
    function confirmSwatch() {
        const label = document.getElementById('swatchLabelInput').value.trim();
        if (!label) { showToast('Inserisci un nome', 'error'); return; }
        if (!pendingSwatchImage) { showToast("Seleziona un'immagine", 'error'); return; }

        if (activeTab === 'materials') {
            const cat = materialsData[editingCategoryIndex];
            if (!cat.swatches) cat.swatches = [];
            cat.swatches.push({
                file: pendingSwatchImage.fileName,
                label: label,
                _pendingUpload: { base64: pendingSwatchImage.base64, base64Full: pendingSwatchImage.base64Full, folder: cat.folder }
            });
            renderCategories();
        } else {
            const cat = modelsData[editingCategoryIndex];
            if (editingModelIndex === -1) {
                // Add Model
                const folder = slugify(label); // Auto-generate folder from name
                if (!cat.models) cat.models = [];
                cat.models.push({
                    id: slugify(label),
                    name: label,
                    folder: folder,
                    base: pendingSwatchImage.fileName,
                    masks: [],
                    _pendingBaseUpload: { base64: pendingSwatchImage.base64, base64Full: pendingSwatchImage.base64Full, folder: folder }
                });
            } else {
                // Add Mask
                const mod = cat.models[editingModelIndex];
                if (!mod.masks) mod.masks = [];
                mod.masks.push({
                    file: pendingSwatchImage.fileName,
                    label: label,
                    _pendingUpload: { base64: pendingSwatchImage.base64, base64Full: pendingSwatchImage.base64Full, folder: mod.folder }
                });
            }
            renderModels();
        }

        closeModal('modalSwatch');
        updateStatus();
        showToast('Elemento aggiunto', 'success');
    }

    // ─── DELETE ──────────────────────
    function confirmDelete() {
        if (!deletingTarget) return;

        if (deletingTarget.type === 'category') {
            materialsData.splice(deletingTarget.catIdx, 1);
        } else if (deletingTarget.type === 'swatch') {
            materialsData[deletingTarget.catIdx].swatches.splice(deletingTarget.swIdx, 1);
        } else if (deletingTarget.type === 'modelCat') {
            modelsData.splice(deletingTarget.catIdx, 1);
        } else if (deletingTarget.type === 'model') {
            modelsData[deletingTarget.catIdx].models.splice(deletingTarget.modIdx, 1);
        } else if (deletingTarget.type === 'mask') {
            modelsData[deletingTarget.catIdx].models[deletingTarget.modIdx].masks.splice(deletingTarget.maskIdx, 1);
        }

        deletingTarget = null;
        closeModal('modalDelete');
        if (activeTab === 'materials') renderCategories(); else renderModels();
        updateStatus();
    }

    // ─── SAVE & PUBLISH ──────────────
    async function saveAndPublish() {
        const btn = document.getElementById('btnSavePublish');
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Pubblicazione…`;
        setStatus('saving', 'Pubblicazione…');

        try {
            const materialsChanged = hasMaterialsChanges();
            const modelsChanged = hasModelsChanges();

            // 1. Upload any pending images (Materials)
            const pendingUploads = [];
            if (materialsChanged) {
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
            }

            // 2. Upload any pending images (Models)
            if (modelsChanged) {
                modelsData.forEach(cat => {
                    if (cat.models) {
                        cat.models.forEach(mod => {
                            if (mod._pendingBaseUpload) {
                                pendingUploads.push({
                                    path: `${MODELS_IMAGES_BASE}/${mod._pendingBaseUpload.folder}/${mod.base}`,
                                    base64: mod._pendingBaseUpload.base64,
                                    label: `Base ${mod.name}`
                                });
                            }
                            if (mod.masks) {
                                mod.masks.forEach(mk => {
                                    if (mk._pendingUpload) {
                                        pendingUploads.push({
                                            path: `${MODELS_IMAGES_BASE}/${mk._pendingUpload.folder}/${mk.file}`,
                                            base64: mk._pendingUpload.base64,
                                            label: mk.label
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }

            for (const upload of pendingUploads) {
                setStatus('saving', `Caricamento ${upload.label}…`);
                await uploadImage(
                    upload.path,
                    upload.base64,
                    `[Admin] Aggiunta immagine: ${upload.label}`
                );
            }

            // 3. Commit materials.json if changed
            if (materialsChanged) {
                const cleanMatData = materialsData.map(cat => ({
                    id: cat.id,
                    name: cat.name,
                    folder: cat.folder,
                    swatches: cat.swatches.map(sw => ({
                        file: sw.file,
                        label: sw.label
                    }))
                }));

                setStatus('saving', 'Salvataggio materials.json…');
                const jsonMatContent = JSON.stringify(cleanMatData, null, 4);
                const resultMat = await commitFile(
                    MATERIALS_PATH,
                    jsonMatContent,
                    `[Admin] Aggiornamento materiali (${new Date().toLocaleString('it-IT')})`,
                    fileSha
                );

                fileSha = resultMat.content.sha;
                materialsData = cleanMatData;
                originalJSON = JSON.stringify(materialsData);
                localStorage.setItem('leboffi_materials_data', jsonMatContent);
            }

            // 4. Commit models.json if changed
            if (modelsChanged) {
                const cleanModData = modelsData.map(cat => ({
                    id: cat.id,
                    name: cat.name,
                    models: (cat.models || []).map(mod => ({
                        id: mod.id,
                        name: mod.name,
                        folder: mod.folder || slugify(mod.name), // Ensure model folder exists
                        base: mod.base,
                        masks: (mod.masks || []).map(mk => ({
                            file: mk.file,
                            label: mk.label
                        }))
                    }))
                }));

                setStatus('saving', 'Salvataggio models.json…');
                const jsonModContent = JSON.stringify(cleanModData, null, 4);
                const resultMod = await commitFile(
                    MODELS_PATH,
                    jsonModContent,
                    `[Admin] Aggiornamento modelli (${new Date().toLocaleString('it-IT')})`,
                    modelsFileSha
                );

                modelsFileSha = resultMod.content.sha;
                modelsData = cleanModData;
                originalModelsJSON = JSON.stringify(modelsData);
                localStorage.setItem('leboffi_models_data', jsonModContent);
            }

            if (activeTab === 'materials') renderCategories();
            else renderModels();

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

    // ─── STATUS TRACKING ─────────────
    function hasMaterialsChanges() {
        const currentClean = materialsData.map(cat => ({
            id: cat.id,
            name: cat.name,
            folder: cat.folder,
            swatches: cat.swatches.map(sw => ({
                file: sw.file,
                label: sw.label
            }))
        }));
        return JSON.stringify(currentClean) !== originalJSON;
    }

    function hasModelsChanges() {
        const currentClean = modelsData.map(cat => ({
            id: cat.id,
            name: cat.name,
            models: (cat.models || []).map(mod => ({
                id: mod.id,
                name: mod.name,
                folder: mod.folder,
                base: mod.base,
                masks: (mod.masks || []).map(mk => ({
                    file: mk.file,
                    label: mk.label
                }))
            }))
        }));
        return JSON.stringify(currentClean) !== originalModelsJSON;
    }

    function hasChanges() {
        return hasMaterialsChanges() || hasModelsChanges();
    }

    function updateStatus() {
        const changed = hasChanges();
        const btn = document.getElementById('btnSavePublish');
        btn.disabled = !changed;

        if (changed) {
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
        const area = document.getElementById('uploadArea');
        const fileInput = document.getElementById('swatchFileInput');
        const preview = document.getElementById('uploadPreview');
        const placeholder = document.getElementById('uploadPlaceholder');

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) processFile(file);
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
                processFile(file);
            }
        });

        function processFile(file) {
            const reader = new FileReader();
            reader.onload = () => {
                const base64Full = reader.result;
                const base64Data = base64Full.split(',')[1];
                pendingSwatchImage = {
                    base64: base64Data,
                    fileName: file.name
                };
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
