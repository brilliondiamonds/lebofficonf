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
            img.onerror = () => reject(new Error('Failed: ' + src));
            img.src = src;
        });
    }

    async function init() {
        try {
            const [mRes, matRes] = await Promise.all([
                fetch('models.json').then(r => r.json()),
                fetch('materials.json').then(r => r.json())
            ]);
            modelsData = mRes;

            // Check for admin-synced materials (updated via admin panel)
            const adminMaterials = localStorage.getItem('leboffi_materials_data');
            if (adminMaterials) {
                try {
                    materialsData = JSON.parse(adminMaterials);
                    console.log('[App] Using admin-synced materials from localStorage');
                } catch (e) {
                    materialsData = matRes;
                }
            } else {
                materialsData = matRes;
            }

            // Check for admin-synced models
            const adminModels = localStorage.getItem('leboffi_models_data');
            if (adminModels) {
                try {
                    modelsData = JSON.parse(adminModels);
                    console.log('[App] Using admin-synced models from localStorage');
                } catch (e) {
                    modelsData = mRes;
                }
            } else {
                modelsData = mRes;
            }
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
        modelsData.forEach(model => {
            const card = document.createElement('button');
            card.className = 'model-card';
            card.dataset.id = model.id;
            const src = encodeURI('images/modelli/' + model.folder + '/' + model.base);
            card.innerHTML =
                '<div class="model-thumb"><img src="' + src + '" alt="' + model.name + '" loading="lazy"/></div>' +
                '<span class="model-name">' + model.name + '</span>';
            card.addEventListener('click', () => selectModel(model));
            grid.appendChild(card);
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
                const imgSrc = encodeURI('images/materiali/' + cat.folder + '/' + sw.file);
                const curMat = maskMaterials[activeMaskIndex];
                if (curMat && curMat.categoryId === cat.id && curMat.file === sw.file) {
                    card.classList.add('selected');
                }
                card.innerHTML =
                    '<div class="swatch-img"><img src="' + imgSrc + '" alt="' + sw.label + '" loading="lazy"/></div>' +
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
    function drawExportSummary() {
        const W = canvas.width;
        const H = canvas.height;
        const padding = 40;
        const lineHeight = 48;
        const titleSize = 42;
        const textSize = 32;

        // Build summary lines
        const lines = [];
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
        ctx.fillText('✦  ' + selectedModel.name, padding, panelY + padding);

        // Mask → Material lines
        ctx.font = textSize + 'px Assistant, sans-serif';
        ctx.fillStyle = '#e0e0e0';
        lines.forEach((line, i) => {
            ctx.fillText(line, padding + 20, panelY + padding + lineHeight + i * lineHeight + 10);
        });
    }

    function setupExport() {
        document.getElementById('btnExport').addEventListener('click', () => {
            if (!selectedModel) return;
            // Re-render without highlights for export
            const savedHover = hoveredMaskIndex;
            const savedStep = currentStep;
            hoveredMaskIndex = -1;
            currentStep = -1; // suppress active mask highlight
            renderShoe().then(() => {
                drawExportSummary();
                const a = document.createElement('a');
                a.download = 'leboffi-' + selectedModel.id + '.png';
                a.href = canvas.toDataURL('image/png');
                a.click();
                hoveredMaskIndex = savedHover;
                currentStep = savedStep;
                renderShoe();
                showToast('Immagine esportata!', 'success');
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

    document.addEventListener('DOMContentLoaded', init);
})();
