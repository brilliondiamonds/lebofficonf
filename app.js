/* LE BOFFI – Shoe Configurator */
(function () {
    'use strict';

    let modelsData = [];
    let materialsData = [];
    let currentStep = 0;
    let selectedModel = null;
    let activeMaskIndex = 0;
    let maskMaterials = {};

    // Pre-loaded mask canvases for hit-testing
    let maskHitCanvases = []; // [{canvas, ctx, label}]
    let hoveredMaskIndex = -1;
    let lastFitRect = null;

    const canvas = document.getElementById('shoeCanvas');
    const ctx = canvas.getContext('2d');
    const toast = document.getElementById('toast');

    const imageCache = {};
    function loadImage(src) {
        if (imageCache[src]) return Promise.resolve(imageCache[src]);
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { imageCache[src] = img; resolve(img); };
            img.onerror = () => {
                if (!src.startsWith('http') && !src.startsWith('data:')) {
                    const baseSrc = src.split('?')[0]; // Rimuove eventuali vecchi cache buster
                    const fallbackSrc = 'https://raw.githubusercontent.com/brilliondiamonds/lebofficonf/main/' + baseSrc + '?v=' + new Date().getTime();
                    const fbImg = new Image();
                    fbImg.crossOrigin = 'anonymous';
                    fbImg.onload = () => { imageCache[src] = fbImg; resolve(fbImg); };
                    fbImg.onerror = () => reject(new Error('Failed: ' + src));
                    fbImg.src = fallbackSrc;
                } else {
                    reject(new Error('Failed: ' + src));
                }
            };
            img.src = src;
        });
    }

    async function loadDataFile(fileName) {
        const timestamp = new Date().getTime();
        try {
            const rawUrl = `https://raw.githubusercontent.com/brilliondiamonds/lebofficonf/main/${fileName}?t=${timestamp}`;
            const ghRes = await fetch(rawUrl);
            if (ghRes.ok) {
                console.log(`[App] ${fileName} caricato da GitHub (istantaneo)`);
                return await ghRes.json();
            }
            throw new Error(`GitHub raw HTTP ${ghRes.status}`);
        } catch (e) {
            console.warn(`[App] Fallback: carico ${fileName} in locale (server)`, e);
            const localRes = await fetch(`${fileName}?v=${timestamp}`);
            return await localRes.json();
        }
    }

    async function init() {
        try {
            const [mRes, matRes] = await Promise.all([
                loadDataFile('models.json'),
                loadDataFile('materials.json')
            ]);

            // Fix temporanea per la cartella di agata-mule
            mRes.forEach(cat => {
                if (cat.models) {
                    cat.models.forEach(m => {
                        if (m.id === 'agata-mule' && m.folder === 'agata-mule') {
                            m.folder = 'AGATA MULE';
                        }
                    });
                }
            });

            modelsData = mRes;
            materialsData = matRes;

        } catch (e) {
            console.error('Load error:', e);
            return;
        }
        renderModelGrid();
        setupStepNav();
        setupStepActions();
        setupExport();
        setupCanvasInteraction();
        registerSW();
        setupInstall();
    }

    // ─── STEP NAV ────────────────────
    function setupStepNav() {
        document.querySelectorAll('.step-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const s = parseInt(tab.dataset.step);
                if (s === 1 && !selectedModel) { showToast('Seleziona prima un modello'); return; }
                currentStep = s;
                updateStepUI();
            });
        });
    }

    function setupStepActions() {
        document.getElementById('btnNext').addEventListener('click', () => {
            if (!selectedModel) { showToast('Seleziona prima un modello'); return; }
            currentStep = 1;
            updateStepUI();
        });
        document.getElementById('btnPrev').addEventListener('click', () => {
            currentStep = 0;
            updateStepUI();
        });
    }

    function updateStepUI() {
        document.querySelectorAll('.step-tab').forEach((tab, i) => {
            tab.classList.remove('active', 'completed');
            if (i === currentStep) tab.classList.add('active');
            else if (i < currentStep) tab.classList.add('completed');
        });
        document.querySelectorAll('.step-panel').forEach((p, i) => {
            p.classList.toggle('active', i === currentStep);
        });
    }

    // ─── MODEL GRID ──────────────────
    function renderModelGrid() {
        const grid = document.getElementById('modelGrid');
        grid.innerHTML = '';
        modelsData.forEach(cat => {
            const div = document.createElement('div');
            // Categoria dei modelli chiusa di default come quelle dei materiali
            div.className = 'mat-category';

            const modelsCount = cat.models ? cat.models.length : 0;

            const header = document.createElement('button');
            header.className = 'mat-cat-header';
            header.innerHTML =
                '<span><span class="mat-cat-name">' + cat.name + '</span>' +
                '<span class="mat-cat-count">' + modelsCount + '</span></span>' +
                '<svg class="mat-cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

            header.addEventListener('click', () => {
                const wasOpen = div.classList.contains('open');
                // Opzionale: chiudi le altre categorie quando se ne apre una
                // grid.querySelectorAll('.mat-category').forEach(c => c.classList.remove('open'));
                if (!wasOpen) div.classList.add('open');
                else div.classList.remove('open');
            });

            const content = document.createElement('div');
            content.className = 'mat-cat-content';
            const catGrid = document.createElement('div');
            catGrid.className = 'model-grid';

            if (cat.models && cat.models.length > 0) {
                cat.models.forEach(model => {
                    const card = document.createElement('button');
                    card.className = 'model-card';
                    card.dataset.id = model.id;
                    const src = encodeURI('images/modelli/' + model.folder + '/' + model.base);
                    const ts = new Date().getTime();
                    const fallbackSrc = 'https://raw.githubusercontent.com/brilliondiamonds/lebofficonf/main/' + src + '?v=' + ts;
                    card.innerHTML =
                        '<div class="model-thumb"><img src="' + src + '" alt="' + model.name + '" loading="lazy" onerror="if(!this.dataset.fb){ this.dataset.fb=\'1\'; this.src=\'' + fallbackSrc + '\'; }"/></div>' +
                        '<span class="model-name">' + model.name + '</span>';
                    card.addEventListener('click', () => selectModel(model));
                    catGrid.appendChild(card);
                });
            } else {
                // Messaggio vuoto per indicare che non ci sono modelli in questa categoria
                catGrid.innerHTML = '<span style="color:var(--text-muted);font-size:14px;padding:8px;">Nessun modello disponibile</span>';
            }

            content.appendChild(catGrid);
            div.appendChild(header);
            div.appendChild(content);
            grid.appendChild(div);
        });
    }

    async function selectModel(model) {
        selectedModel = model;
        activeMaskIndex = 0;
        maskMaterials = {};

        document.querySelectorAll('.model-card').forEach(c =>
            c.classList.toggle('selected', c.dataset.id === model.id)
        );

        document.getElementById('viewerPlaceholder').style.display = 'none';
        canvas.style.display = 'block';
        document.getElementById('btnExport').disabled = false;

        const baseSrc = encodeURI('images/modelli/' + model.folder + '/' + model.base);
        try {
            const baseImg = await loadImage(baseSrc);
            canvas.width = 2048;
            canvas.height = 2048;
            lastFitRect = fitRect(baseImg.naturalWidth, baseImg.naturalHeight, 2048, 2048);
            await buildMaskHitCanvases();
            renderShoe();
        } catch (e) { console.error('Base load error:', e); }

        renderMaskTabs();
        renderMaterialCategories();
        showToast(model.name + ' selezionato', 'success');
    }

    // ─── MASK HIT CANVASES ───────────
    async function buildMaskHitCanvases() {
        maskHitCanvases = [];
        if (!selectedModel || !lastFitRect) return;
        const r = lastFitRect;

        for (let i = 0; i < selectedModel.masks.length; i++) {
            const mask = selectedModel.masks[i];
            const maskSrc = encodeURI('images/modelli/' + selectedModel.folder + '/' + mask.file);
            try {
                const maskImg = await loadImage(maskSrc);
                const off = document.createElement('canvas');
                off.width = 2048; off.height = 2048;
                const oc = off.getContext('2d');
                oc.drawImage(maskImg, r.x, r.y, r.w, r.h);
                maskHitCanvases.push({ canvas: off, ctx: oc, label: mask.label });
            } catch (e) {
                maskHitCanvases.push(null);
            }
        }
    }

    function hitTestMask(canvasX, canvasY) {
        // Test masks in reverse order (top-most first)
        for (let i = maskHitCanvases.length - 1; i >= 0; i--) {
            const entry = maskHitCanvases[i];
            if (!entry) continue;
            const pixel = entry.ctx.getImageData(Math.round(canvasX), Math.round(canvasY), 1, 1).data;
            if (pixel[3] > 30) return i; // alpha threshold
        }
        return -1;
    }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    // ─── CANVAS INTERACTION ──────────
    function setupCanvasInteraction() {
        canvas.addEventListener('mousemove', (e) => {
            if (!selectedModel || maskHitCanvases.length === 0) {
                canvas.style.cursor = 'default';
                return;
            }
            const coords = getCanvasCoords(e);
            const hit = hitTestMask(coords.x, coords.y);

            if (hit !== hoveredMaskIndex) {
                hoveredMaskIndex = hit;
                canvas.style.cursor = hit >= 0 ? 'pointer' : 'default';
                renderShoe(); // re-render with highlight
            }
        });

        canvas.addEventListener('mouseleave', () => {
            if (hoveredMaskIndex !== -1) {
                hoveredMaskIndex = -1;
                renderShoe();
            }
            canvas.style.cursor = 'default';
        });

        canvas.addEventListener('click', (e) => {
            if (!selectedModel || maskHitCanvases.length === 0) return;
            const coords = getCanvasCoords(e);
            const hit = hitTestMask(coords.x, coords.y);

            if (hit >= 0) {
                activeMaskIndex = hit;
                // Auto-switch to Step 2 (Material) if on Step 1
                if (currentStep === 0) {
                    currentStep = 1;
                    updateStepUI();
                }
                renderMaskTabs();
                renderMaterialCategories();
                renderShoe();
                showToast('Parte: ' + selectedModel.masks[hit].label, 'success');
            }
        });
    }

    // ─── MASK TABS ───────────────────
    function renderMaskTabs() {
        const container = document.getElementById('maskTabs');
        container.innerHTML = '';
        if (!selectedModel) return;

        selectedModel.masks.forEach((mask, i) => {
            const btn = document.createElement('button');
            btn.className = 'mask-tab' + (i === activeMaskIndex ? ' active' : '');
            if (maskMaterials[i]) btn.classList.add('assigned');
            btn.innerHTML =
                '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' +
                mask.label;
            btn.addEventListener('click', () => {
                activeMaskIndex = i;
                renderMaskTabs();
                updateMaskLabel();
                renderShoe();
            });
            container.appendChild(btn);
        });
        updateMaskLabel();
    }

    function updateMaskLabel() {
        const lbl = document.getElementById('activeMaskLabel');
        if (!selectedModel) { lbl.innerHTML = ''; return; }
        const mask = selectedModel.masks[activeMaskIndex];
        const mat = maskMaterials[activeMaskIndex];
        lbl.innerHTML = mat
            ? '<strong>' + mask.label + '</strong> → ' + mat.label
            : 'Scegli il materiale per <strong>' + mask.label + '</strong>';
    }

    // ─── MATERIAL CATEGORIES ─────────
    function renderMaterialCategories() {
        const container = document.getElementById('materialCategories');
        container.innerHTML = '';

        materialsData.forEach(cat => {
            const div = document.createElement('div');
            div.className = 'mat-category';

            const header = document.createElement('button');
            header.className = 'mat-cat-header';
            header.innerHTML =
                '<span><span class="mat-cat-name">' + cat.name + '</span>' +
                '<span class="mat-cat-count">' + cat.swatches.length + '</span></span>' +
                '<svg class="mat-cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

            header.addEventListener('click', () => {
                const wasOpen = div.classList.contains('open');
                container.querySelectorAll('.mat-category').forEach(c => c.classList.remove('open'));
                if (!wasOpen) div.classList.add('open');
            });

            const content = document.createElement('div');
            content.className = 'mat-cat-content';
            const grid = document.createElement('div');
            grid.className = 'swatch-grid';

            cat.swatches.forEach(sw => {
                const card = document.createElement('button');
                card.className = 'swatch-card';
                const ts = new Date().getTime();
                const imgSrc = encodeURI('images/materiali/' + cat.folder + '/' + sw.file);
                const fallbackSrc = 'https://raw.githubusercontent.com/brilliondiamonds/lebofficonf/main/' + imgSrc + '?v=' + ts;
                const curMat = maskMaterials[activeMaskIndex];
                if (curMat && curMat.categoryId === cat.id && curMat.file === sw.file) {
                    card.classList.add('selected');
                }
                card.innerHTML =
                    '<div class="swatch-img"><img src="' + imgSrc + '" alt="' + sw.label + '" loading="lazy" onerror="if(!this.dataset.fb){ this.dataset.fb=\'1\'; this.src=\'' + fallbackSrc + '\'; }"/></div>' +
                    '<span class="swatch-name">' + sw.label + '</span>';
                card.addEventListener('click', () => assignMaterial(activeMaskIndex, cat.id, sw.file, sw.label, imgSrc));
                grid.appendChild(card);
            });

            content.appendChild(grid);
            div.appendChild(header);
            div.appendChild(content);
            container.appendChild(div);
        });
    }

    function assignMaterial(maskIdx, categoryId, file, label, textureUrl) {
        maskMaterials[maskIdx] = { categoryId, file, label, textureUrl };

        const total = selectedModel.masks.length;
        let next = -1;
        for (let i = 1; i <= total; i++) {
            const c = (maskIdx + i) % total;
            if (!maskMaterials[c]) { next = c; break; }
        }
        if (next >= 0) activeMaskIndex = next;

        renderMaskTabs();
        renderMaterialCategories();
        renderShoe();
        showToast(label + ' → ' + selectedModel.masks[maskIdx].label, 'success');
    }

    // ─── RENDERING ───────────────────
    function fitRect(iw, ih, cw, ch) {
        const s = Math.min(cw / iw, ch / ih);
        const w = iw * s, h = ih * s;
        return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
    }

    async function renderShoe() {
        if (!selectedModel) return;
        const baseSrc = encodeURI('images/modelli/' + selectedModel.folder + '/' + selectedModel.base);
        let baseImg;
        try { baseImg = await loadImage(baseSrc); } catch (e) { return; }

        const W = 2048, H = 2048;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        const r = lastFitRect || fitRect(baseImg.naturalWidth, baseImg.naturalHeight, W, H);
        ctx.drawImage(baseImg, r.x, r.y, r.w, r.h);

        // Draw textured masks
        for (let i = 0; i < selectedModel.masks.length; i++) {
            const mat = maskMaterials[i];
            if (!mat) continue;
            const maskSrc = encodeURI('images/modelli/' + selectedModel.folder + '/' + selectedModel.masks[i].file);
            try {
                const [maskImg, texImg] = await Promise.all([loadImage(maskSrc), loadImage(mat.textureUrl)]);
                const off = document.createElement('canvas');
                off.width = W; off.height = H;
                const oc = off.getContext('2d');

                oc.drawImage(maskImg, r.x, r.y, r.w, r.h);
                oc.globalCompositeOperation = 'source-in';
                const tw = texImg.naturalWidth, th = texImg.naturalHeight;
                const ts = Math.max(W / tw, H / th);
                oc.drawImage(texImg, (W - tw * ts) / 2, (H - th * ts) / 2, tw * ts, th * ts);
                // Re-apply mask with multiply to preserve stitching & shadow details
                oc.globalCompositeOperation = 'multiply';
                oc.drawImage(maskImg, r.x, r.y, r.w, r.h);
                oc.globalCompositeOperation = 'source-over';

                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(off, 0, 0);
            } catch (e) { console.warn('Mask error:', e); }
        }

        // Draw hover highlight only on masks WITHOUT a material assigned
        if (hoveredMaskIndex >= 0 && maskHitCanvases[hoveredMaskIndex] && !maskMaterials[hoveredMaskIndex]) {
            const hc = maskHitCanvases[hoveredMaskIndex];
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 0.15;
            const hOff = document.createElement('canvas');
            hOff.width = W; hOff.height = H;
            const hCtx = hOff.getContext('2d');
            hCtx.drawImage(hc.canvas, 0, 0);
            hCtx.globalCompositeOperation = 'source-in';
            hCtx.fillStyle = '#b03d75';
            hCtx.fillRect(0, 0, W, H);
            ctx.drawImage(hOff, 0, 0);
            ctx.globalAlpha = 1.0;
        }
    }

    // ─── EXPORT ──────────────────────
    async function drawExportSummary(clientName) {
        const W = canvas.width;
        const H = canvas.height;
        const padding = 40;
        const lineHeight = 48;
        const titleSize = 42;
        const textSize = 32;

        // Build summary lines
        const lines = [];
        if (clientName && clientName.trim() !== '') {
            lines.push('Cliente: ' + clientName.trim());
        }

        selectedModel.masks.forEach((mask, i) => {
            const mat = maskMaterials[i];
            lines.push(mask.label + ':  ' + (mat ? mat.label : '—'));
        });

        const panelH = padding * 2 + lineHeight + lines.length * lineHeight + 10;
        const panelY = H - panelH;

        // Semi-transparent dark background
        ctx.fillStyle = 'rgba(30, 30, 30, 0.85)';
        ctx.fillRect(0, panelY, W, panelH);

        // Top border accent
        ctx.fillStyle = '#b03d75';
        ctx.fillRect(0, panelY, W, 4);

        // Model name (title)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + titleSize + 'px Assistant, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(selectedModel.name, padding + 20, panelY + padding);

        // Mask → Material lines
        ctx.font = textSize + 'px Assistant, sans-serif';
        ctx.fillStyle = '#e0e0e0';
        lines.forEach((line, i) => {
            if (line.startsWith('Cliente:')) {
                ctx.font = 'bold ' + textSize + 'px Assistant, sans-serif';
                ctx.fillStyle = '#ffffff';
            } else {
                ctx.font = textSize + 'px Assistant, sans-serif';
                ctx.fillStyle = '#e0e0e0';
            }
            ctx.fillText(line, padding + 20, panelY + padding + lineHeight + i * lineHeight + 10);
        });

        // Draw Logo on the right
        try {
            const logoUrl = encodeURI('images/logo/logo.avif');
            const logoImg = await loadImage(logoUrl);

            // Calculate scale to fit nicely in the panel
            const maxLogoHeight = panelH - padding * 2;
            const maxLogoWidth = 400; // max width space we want to give to the logo
            let logoW = logoImg.naturalWidth;
            let logoH = logoImg.naturalHeight;
            const scale = Math.min(maxLogoWidth / logoW, maxLogoHeight / logoH);

            logoW = logoW * scale;
            logoH = logoH * scale;

            // Align logo to the right, centered vertically within the panel
            const logoX = W - padding - logoW;
            const logoY = panelY + (panelH - logoH) / 2;

            ctx.drawImage(logoImg, logoX, logoY, logoW, logoH);
        } catch (e) {
            console.warn('Impossibile caricare il logo per l\'esportazione', e);
        }
    }

    function setupExport() {
        const dropdown = document.getElementById('exportDropdownMenu');
        const input = document.getElementById('clientNameInput');
        const btnExport = document.getElementById('btnExport');
        const btnConfirm = document.getElementById('btnConfirmExport');

        btnExport.addEventListener('click', (e) => {
            if (!selectedModel) return;
            e.stopPropagation(); // Prevent closing immediately

            const isHidden = dropdown.classList.contains('hidden');
            if (isHidden) {
                dropdown.classList.remove('hidden');
                setTimeout(() => input.focus(), 100);
            } else {
                dropdown.classList.add('hidden');
            }
        });

        function closeExportDropdown() {
            dropdown.classList.add('hidden');
            input.blur();
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && e.target !== btnExport) {
                closeExportDropdown();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeExportDropdown();
            if (e.key === 'Enter') btnConfirm.click();
        });

        btnConfirm.addEventListener('click', () => {
            if (!selectedModel) return;

            const clientName = input.value;
            closeExportDropdown();

            // Re-render without highlights for export
            const savedHover = hoveredMaskIndex;
            const savedStep = currentStep;
            hoveredMaskIndex = -1;
            currentStep = -1; // suppress active mask highlight
            renderShoe().then(async () => {
                await drawExportSummary(clientName);

                let fileName = 'leboffi-' + selectedModel.id;
                if (clientName && clientName.trim() !== '') {
                    fileName += '-' + clientName.trim().replace(/[^a-z0-9]/gi, '-').toLowerCase();
                }
                const fullFileName = fileName + '.png';

                const performExport = () => {
                    hoveredMaskIndex = savedHover;
                    currentStep = savedStep;
                    renderShoe();
                };

                const fallbackDownload = () => {
                    const a = document.createElement('a');
                    a.download = fullFileName;
                    a.href = canvas.toDataURL('image/png');
                    a.click();
                    performExport();
                    showToast('Immagine esportata!', 'success');
                };

                // Try native Web Share API first (fixes iOS download issue)
                canvas.toBlob(async (blob) => {
                    if (!blob) {
                        fallbackDownload();
                        return;
                    }

                    const file = new File([blob], fullFileName, { type: blob.type });

                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        try {
                            await navigator.share({
                                files: [file],
                                title: 'Le Boffi - ' + selectedModel.name
                            });
                            performExport();
                            // Non mostriamo il toast di successo perché il menu nativo di sistema lo gestisce già visivamente
                        } catch (err) {
                            if (err.name !== 'AbortError') {
                                console.error('Errore nella condivisione:', err);
                                fallbackDownload();
                            } else {
                                // L'utente ha chiuso il pannello di condivisione
                                performExport();
                            }
                        }
                    } else {
                        // Web Share API non supportata o impossibile condividere file (es. desktop vecchi)
                        fallbackDownload();
                    }
                }, 'image/png');
            });
        });
    }

    // ─── TOAST ───────────────────────
    function showToast(msg, type) {
        toast.textContent = msg;
        toast.className = 'toast show ' + (type || 'success');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => { toast.className = 'toast'; }, 2200);
    }

    // ─── SW + PWA ────────────────────
    function registerSW() {
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
    }
    let dp = null;
    function setupInstall() {
        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault(); dp = e;
            const b = document.getElementById('btnInstall');
            b.style.display = 'flex';
            b.addEventListener('click', async () => { if (dp) { dp.prompt(); await dp.userChoice; dp = null; b.style.display = 'none'; } });
        });
    }

    function setupScrollListener() {
        const viewerCol = document.querySelector('.viewer-col');
        if (!viewerCol) return;

        // On mobile, the actual scroll happens inside .panel-scroll
        const panels = document.querySelectorAll('.panel-scroll');

        panels.forEach(panel => {
            panel.addEventListener('scroll', (e) => {
                if (window.innerWidth <= 960) {
                    if (e.target.scrollTop > 30) {
                        viewerCol.classList.add('scrolled');
                    } else {
                        viewerCol.classList.remove('scrolled');
                    }
                }
            });
        });

        // Fallback for desktop window scrolling (if any)
        window.addEventListener('scroll', () => {
            if (window.innerWidth > 960) {
                if (window.scrollY > 30) {
                    viewerCol.classList.add('scrolled');
                } else {
                    viewerCol.classList.remove('scrolled');
                }
            }
        });

        // Re-bind on resize to handle orientation/resizing
        window.addEventListener('resize', () => {
            const isMobile = window.innerWidth <= 960;
            const isScrolled = viewerCol.classList.contains('scrolled');
            if (!isMobile && isScrolled) viewerCol.classList.remove('scrolled');
        });
    }

    function setupPreviewTouchSync() {
        const viewerCol = document.querySelector('.viewer-col');
        if (!viewerCol) return;

        let touchStartY = 0;

        viewerCol.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 960) return;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        viewerCol.addEventListener('touchmove', (e) => {
            if (window.innerWidth > 960) return;
            const touchY = e.touches[0].clientY;
            const deltaY = touchStartY - touchY;
            touchStartY = touchY;

            const activePanel = document.querySelector('.step-panel.active .panel-scroll');
            if (activePanel) {
                activePanel.scrollTop += deltaY;
            }
        }, { passive: false });

        viewerCol.addEventListener('wheel', (e) => {
            if (window.innerWidth > 960) return;
            const activePanel = document.querySelector('.step-panel.active .panel-scroll');
            if (activePanel) {
                activePanel.scrollTop += e.deltaY;
            }
        }, { passive: true });
    }

    document.addEventListener('DOMContentLoaded', () => {
        init();
        setupScrollListener();
        setupPreviewTouchSync();
    });
})();
