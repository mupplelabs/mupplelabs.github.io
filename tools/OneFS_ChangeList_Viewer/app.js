// --- State Management ---
let rawEntries = [];
let processedEntries = [];
let filteredEntries = [];
let selectedEntry = null;
let currentTheme = new URLSearchParams(window.location.search).get('theme') || 'dark';
let demoDataUrl = new URLSearchParams(window.location.search).get('data_url') || 'large_changelist_demo.json';
let sortColumn = 'path';
let sortDirection = 'asc'; // 'asc' or 'desc'

// initial theme setup
if (currentTheme !== 'dark' && currentTheme !== 'light') {
    currentTheme = 'dark'; // fallback validation
}
document.body.setAttribute('data-theme', currentTheme);

const ALL_COLUMNS = [
    { id: 'path', label: 'Path', always: true },
    { id: 'file_type', label: 'Type', initial: true },
    { id: 'change_types', label: 'Changes', initial: true },
    { id: 'size', label: 'Size', initial: true, type: 'size' },
    { id: 'physical_size', label: 'Physical Size', type: 'size' },
    { id: 'ctime', label: 'CTime', initial: true, type: 'date' },
    { id: 'mtime', label: 'MTime', type: 'date' },
    { id: 'atime', label: 'ATime', type: 'date' },
    { id: 'btime', label: 'BTime', type: 'date' },
    { id: 'lin', label: 'LIN', type: 'number' },
    { id: 'uid', label: 'UID', type: 'number' },
    { id: 'gid', label: 'GID', type: 'number' },
    { id: 'parent_lin', label: 'Parent LIN', type: 'number' },
    { id: 'id', label: 'ID' },
    { id: 'user_flags', label: 'User Flags', type: 'array' },
    { id: 'data_pool', label: 'Data Pool', type: 'number' },
    { id: 'metadata_pool', label: 'Metadata Pool', type: 'number' }
];

let visibleColumnIds = new Set(ALL_COLUMNS.filter(c => c.initial || c.always).map(c => c.id));

// --- Core Detection Logic ---
function detectMoves(entries, opts = { enableLooseMatch: true, ctimeWindowSec: 5 }) {
    const { enableLooseMatch, ctimeWindowSec } = opts;
    const normalized = entries.map(e => ({
        ...e,
        change_types_set: new Set((e.change_types || []).map(String))
    }));

    const byLin = new Map();
    const byId = new Map();

    normalized.forEach(e => {
        if (typeof e.lin === 'number') {
            if (!byLin.has(e.lin)) byLin.set(e.lin, []);
            byLin.get(e.lin).push(e);
        }
        if (e.id) {
            if (!byId.has(e.id)) byId.set(e.id, []);
            byId.get(e.id).push(e);
        }
    });

    const moves = [];
    const pairedNodes = new Set();

    function findPair(group) {
        const removed = group.find(x => x.change_types_set.has('ENTRY_REMOVED') && x.change_types_set.has('ENTRY_PATH_CHANGED'));
        const added = group.find(x => x.change_types_set.has('ENTRY_ADDED') && x.change_types_set.has('ENTRY_PATH_CHANGED'));
        return (removed && added) ? { removed, added } : null;
    }

    function createMoveRecord(removed, added, type) {
        pairedNodes.add(removed);
        pairedNodes.add(added);
        return {
            ...added,
            isMove: true,
            oldPath: removed.path,
            moveType: type
            // Note: we don't modify change_types anymore, we keep it as-is from API
        };
    }

    // Match by LIN
    for (const [lin, group] of byLin.entries()) {
        const pair = findPair(group);
        if (pair) moves.push(createMoveRecord(pair.removed, pair.added, 'LIN'));
    }

    // Match by ID
    for (const [id, group] of byId.entries()) {
        const pair = findPair(group);
        if (pair && !pairedNodes.has(pair.added)) {
            moves.push(createMoveRecord(pair.removed, pair.added, 'ID'));
        }
    }

    // Loose Match
    if (enableLooseMatch) {
        const removeds = normalized.filter(x => !pairedNodes.has(x) && x.change_types_set.has('ENTRY_REMOVED') && x.change_types_set.has('ENTRY_PATH_CHANGED'));
        const addeds = normalized.filter(x => !pairedNodes.has(x) && x.change_types_set.has('ENTRY_ADDED') && x.change_types_set.has('ENTRY_PATH_CHANGED'));

        removeds.forEach(r => {
            const rName = r.path.split('/').pop();
            const rTime = r.ctime?.sec || 0;
            const candidate = addeds.find(a => {
                const aName = a.path.split('/').pop();
                const aTime = a.ctime?.sec || 0;
                return aName === rName && Math.abs(aTime - rTime) <= ctimeWindowSec;
            });
            if (candidate && !pairedNodes.has(candidate)) {
                moves.push(createMoveRecord(r, candidate, 'LOOSE'));
            }
        });
    }

    return [...moves, ...normalized.filter(e => !pairedNodes.has(e))];
}

// --- UI Rendering ---

function handleSort(columnId) {
    if (sortColumn === columnId) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = columnId;
        sortDirection = 'asc';
    }
    renderTable();
}

function renderTable() {
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    // Create Headers
    const headerRow = document.createElement('tr');
    const visibleCols = ALL_COLUMNS.filter(c => visibleColumnIds.has(c.id));
    
    visibleCols.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label;
        th.style.cursor = 'pointer';
        
        if (sortColumn === col.id) {
            th.className = sortDirection === 'asc' ? 'sort-asc' : 'sort-desc';
        }
        
        th.onclick = () => handleSort(col.id);
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    // Sort Data
    let entriesToRender = [...filteredEntries];
    if (sortColumn) {
        const colDef = ALL_COLUMNS.find(c => c.id === sortColumn);
        entriesToRender.sort((a, b) => {
            let valA = a[sortColumn];
            let valB = b[sortColumn];

            // Normalize values for sorting
            if (colDef?.type === 'date') {
                valA = valA?.sec || 0;
                valB = valB?.sec || 0;
            } else if (colDef?.type === 'array' || sortColumn === 'change_types') {
                valA = (valA || []).join(',');
                valB = (valB || []).join(',');
            } else if (sortColumn === 'path') {
                valA = (valA || '').toLowerCase();
                valB = (valB || '').toLowerCase();
            }

            if (valA === valB) return 0;
            if (valA == null) return sortDirection === 'asc' ? -1 : 1;
            if (valB == null) return sortDirection === 'asc' ? 1 : -1;

            let cmp = valA < valB ? -1 : 1;
            return sortDirection === 'asc' ? cmp : -cmp;
        });
    }

    // Create Rows
    entriesToRender.forEach(entry => {
        const tr = document.createElement('tr');
        if (selectedEntry === entry) tr.classList.add('selected');
        tr.onclick = () => selectEntry(entry);

        visibleCols.forEach(col => {
            const td = document.createElement('td');
            const value = entry[col.id];

            if (col.id === 'path') {
                if (entry.isMove) {
                    td.innerHTML = `<div class="path-delta">
                        <span class="path-old">${entry.oldPath}</span>
                        <span class="path-new">${entry.path}</span>
                    </div>`;
                } else {
                    td.textContent = entry.path;
                }
            } else if (col.id === 'change_types') {
                const badges = (entry.change_types || []).map(type => 
                    `<span class="badge badge-${type.replace('ENTRY_', '')}">${type.replace('ENTRY_', '')}</span>`
                );
                td.innerHTML = badges.join(' ');
            } else if (col.type === 'size') {
                td.textContent = value != null ? formatSize(value) : '-';
            } else if (col.type === 'date') {
                td.textContent = value?.sec ? new Date(value.sec * 1000).toLocaleString() : '-';
            } else if (col.type === 'array') {
                td.textContent = Array.isArray(value) ? value.join(', ') : '-';
            } else {
                td.textContent = value != null ? value : '-';
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function selectEntry(entry) {
    selectedEntry = entry;
    const content = document.getElementById('detailsContent');
    const json = JSON.stringify(entry, null, 2);
    content.innerHTML = syntaxHighlight(json);
    renderTable(); // Refresh to show selection highlight
    
    // Auto-open details panel via CSS focus-within
    document.getElementById('detailsPanel').focus();
}

function syntaxHighlight(json) {
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'json-key';
            } else {
                cls = 'json-string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'json-boolean';
        } else if (/null/.test(match)) {
            cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
}

function renderColumnDropdown() {
    const dropdown = document.getElementById('colDropdown');
    dropdown.innerHTML = '';
    ALL_COLUMNS.forEach(col => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = `
            <input type="checkbox" ${visibleColumnIds.has(col.id) ? 'checked' : ''} ${col.always ? 'disabled' : ''}>
            <span>${col.label}</span>
        `;
        item.onclick = (e) => {
            if (col.always) return;
            const cb = item.querySelector('input');
            if (e.target !== cb) cb.checked = !cb.checked;
            
            if (cb.checked) visibleColumnIds.add(col.id);
            else visibleColumnIds.delete(col.id);
            
            renderTable();
            e.stopPropagation();
        };
        dropdown.appendChild(item);
    });
}

// --- Directory Tree Logic ---

function buildTree() {
    const treeRoot = document.getElementById('directoryTree');
    const search = document.getElementById('treeSearch').value.toLowerCase();
    treeRoot.innerHTML = '';

    const rootNode = { label: '/', path: '', children: {}, matches: false, hasMatch: false };
    
    // Build
    processedEntries.forEach(e => {
        const parts = e.path.split('/').filter(p => p);
        let current = rootNode;
        let cumulative = '';
        parts.slice(0, -1).forEach(part => {
            cumulative += '/' + part;
            if (!current.children[part]) {
                current.children[part] = { label: part, path: cumulative, children: {} };
            }
            current = current.children[part];
        });
    });

    // Mark visibility
    function mark(node) {
        node.matches = node.label.toLowerCase().includes(search);
        node.hasMatch = false;
        Object.values(node.children).forEach(child => {
            if (mark(child)) node.hasMatch = true;
        });
        return node.matches || node.hasMatch;
    }
    mark(rootNode);

    // Render
    function render(container, node, depth = 0) {
        if (search && !node.matches && !node.hasMatch) return;

        const div = document.createElement('div');
        div.className = 'tree-node';
        if (window.activePath === node.path) div.classList.add('active');
        div.style.paddingLeft = `${depth * 16 + 16}px`;
        div.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            ${node.label}
        `;
        div.onclick = () => {
            window.activePath = node.path;
            document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('active'));
            div.classList.add('active');
            applyFilters();
        };
        container.appendChild(div);
        Object.values(node.children).sort((a,b) => a.label.localeCompare(b.label)).forEach(c => render(container, c, depth + 1));
    }
    render(treeRoot, rootNode);
}

// --- Filtering Logic ---

function applyFilters() {
    const path = window.activePath || '';
    const search = document.getElementById('tableSearch').value.toLowerCase();
    const type = document.getElementById('typeFilter').value;
    const change = document.getElementById('changeFilter').value;

    filteredEntries = processedEntries.filter(e => {
        const matchesPath = e.path.startsWith(path);
        const matchesSearch = !search || e.path.toLowerCase().includes(search);
        const matchesType = type === 'all' || e.file_type === type;
        const matchesChange = change === 'all' || e.change_types?.includes(change);
        
        return matchesPath && matchesSearch && matchesType && matchesChange;
    });
    renderTable();
    if (!document.getElementById('dashboardOverlay').classList.contains('hidden')) {
        renderDashboard();
    }
}

// --- Analytics Dashboard ---

function renderDashboard() {
    const container = document.getElementById('dashboardContent');
    container.innerHTML = ''; // Clear existing
    
    if (filteredEntries.length === 0) {
        container.innerHTML = '<div style="padding: 24px; color: var(--text-secondary);">No data matches the current filters.</div>';
        return;
    }

    // 1. Change Types Aggregation
    const changeCounts = {};
    // 2. Size Distribution Aggregation
    const sizeBuckets = { '< 1 MB': 0, '1 MB - 100 MB': 0, '100 MB - 1 GB': 0, '> 1 GB': 0 };
    // 3. Top Directories Aggregation
    const dirCounts = {};

    filteredEntries.forEach(e => {
        // Change Types
        (e.change_types || []).forEach(ct => {
            changeCounts[ct] = (changeCounts[ct] || 0) + 1;
        });

        // Sizes (using physical_size or size)
        const size = e.physical_size !== undefined ? e.physical_size : (e.size || 0);
        if (size < 1048576) sizeBuckets['< 1 MB']++;
        else if (size < 104857600) sizeBuckets['1 MB - 100 MB']++;
        else if (size < 1073741824) sizeBuckets['100 MB - 1 GB']++;
        else sizeBuckets['> 1 GB']++;

        // Directories
        const parentPath = e.path.substring(0, e.path.lastIndexOf('/')) || '/';
        dirCounts[parentPath] = (dirCounts[parentPath] || 0) + 1;
    });

    // Helper to generate HTML for a chart card
    function buildChartCard(title, dataObj, maxItems = 10, useBadgeColors = false) {
        // Sort descending
        const sorted = Object.entries(dataObj).sort((a, b) => b[1] - a[1]).slice(0, maxItems);
        const maxVal = sorted.length > 0 ? sorted[0][1] : 1;

        let html = `<div class="chart-card">
                        <h3 class="chart-title">${title}</h3>
                        <div style="display: flex; flex-direction: column; gap: 12px;">`;
        
        sorted.forEach(([label, val]) => {
            const pct = Math.max((val / maxVal) * 100, 1); // at least 1% so line is visible
            let colorVar = 'var(--accent-blue)'; // default
            
            if (useBadgeColors) {
                // Map the api string to our CSS colors manually or by extracting computed styles.
                // For simplicity, we assign specific colors loosely based on our CSS.
                if (label.includes('ADDED')) colorVar = 'var(--accent-green)';
                else if (label.includes('REMOVED')) colorVar = 'var(--accent-red)';
                else if (label.includes('MODIFIED')) colorVar = 'var(--accent-yellow)';
                else if (label.includes('PATH_CHANGED')) colorVar = 'var(--accent-blue)';
                else if (label.includes('ADS')) colorVar = '#4ec9b0';
                else if (label.includes('HARDLINKS')) colorVar = '#c586c0';
                else if (label.includes('LOOKUP_REQ')) colorVar = '#a0a0a0';
                else if (label.includes('WORM')) colorVar = '#d7ba7d';
            }

            // Cleanup label for raw ENTRY_ strings
            const displayLabel = useBadgeColors ? label.replace('ENTRY_', '') : label;

            html += `
                <div class="bar-row">
                    <div class="bar-label-area">
                        <span class="bar-label" title="${displayLabel}">${displayLabel}</span>
                        <span class="bar-value">${val}</span>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill" style="width: ${pct}%; background: ${colorVar};"></div>
                    </div>
                </div>`;
        });

        html += `</div></div>`;
        return html;
    }

    container.innerHTML += buildChartCard('Change Types Distribution', changeCounts, 15, true);
    container.innerHTML += buildChartCard('File Size Distribution', sizeBuckets, 4);
    container.innerHTML += buildChartCard('Top Churned Directories', dirCounts, 10);
}

// --- Initialization & Events ---

// --- Initialization & Events ---

async function loadData(data) {
    rawEntries = Array.isArray(data) ? data : (data.entries || []);
    processedEntries = detectMoves(rawEntries);
    
    // Reset filters and selection
    document.getElementById('tableSearch').value = '';
    document.getElementById('typeFilter').value = 'all';
    document.getElementById('changeFilter').value = 'all';
    document.getElementById('treeSearch').value = '';
    window.activePath = '';
    selectedEntry = null;
    sortColumn = 'path';
    sortDirection = 'asc';
    
    // Clear details panel
    document.getElementById('detailsContent').innerHTML = 'Select an entry to view metadata.';
    
    applyFilters();
    buildTree();
}

document.getElementById('demoBtn').onclick = async () => {
    try {
        const response = await fetch(demoDataUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        loadData(data);
    } catch (err) {
        alert('Failed to load demo data: ' + err.message + '\\n\\nNote: If you are opening this HTML file directly from your local filesystem (file:// protocol), your browser may block the fetch request due to security policies (CORS). Please use a local web server, or select the file manually via "Open File".');
    }
};

document.getElementById('fileInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try { loadData(JSON.parse(event.target.result)); }
        catch (err) { alert('Error: ' + err.message); }
    };
    reader.readAsText(file);
};

document.getElementById('colBtn').onclick = (e) => {
    document.getElementById('colDropdown').classList.toggle('show');
    e.stopPropagation();
};

window.onclick = () => document.getElementById('colDropdown').classList.remove('show');

function applyThemeIcon() {
    const svg = document.getElementById('themeToggle').querySelector('svg');
    if (currentTheme === 'light') {
        // Show moon icon (to switch TO dark mode)
        svg.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
        // Show sun icon (to switch TO light mode)
        svg.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.02 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"/>';
    }
}

document.getElementById('themeToggle').onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', currentTheme);
    applyThemeIcon();
    
    // Optionally update URL to reflect the new theme without reloading the page
    const url = new URL(window.location);
    url.searchParams.set('theme', currentTheme);
    window.history.replaceState({}, '', url);
};

// Ensure correct icon is shown on load based on URL param
applyThemeIcon();

document.getElementById('tableSearch').oninput = applyFilters;
document.getElementById('typeFilter').onchange = applyFilters;
document.getElementById('changeFilter').onchange = applyFilters;
document.getElementById('treeSearch').oninput = buildTree;

document.getElementById('exportBtn').onclick = () => {
    if (filteredEntries.length === 0) return alert('No data to export');
    
    const modal = document.createElement('div');
    modal.id = 'modalOverlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3 style="margin-bottom:16px;">Export Data</h3>
            <p style="margin-bottom:20px; color:var(--text-secondary); font-size:0.75rem;">Select format for ${filteredEntries.length} entries.</p>
            <div style="display:flex; gap:10px; justify-content:center;">
                <button class="btn btn-primary" id="btnCSV">CSV</button>
                <button class="btn" id="btnJSON">JSON</button>
                <button class="btn" style="background:#555;" id="btnCancel">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const exportFile = (format) => {
        let content, mime, ext;
        if (format === 'json') {
            content = JSON.stringify(filteredEntries, null, 2);
            mime = 'application/json'; ext = 'json';
        } else {
            const cols = ALL_COLUMNS.filter(c => visibleColumnIds.has(c.id));
            const head = cols.map(c => c.label).join(',');
            const rows = filteredEntries.map(e => cols.map(c => {
                const val = e[c.id];
                return `"${(val != null ? val : '').toString().replace(/"/g, '""')}"`;
            }).join(','));
            content = [head, ...rows].join('\n');
            mime = 'text/csv'; ext = 'csv';
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([content], { type: mime }));
        a.download = `changelist_export.${ext}`;
        a.click();
        document.body.removeChild(modal);
    };

    document.getElementById('btnCSV').onclick = () => exportFile('csv');
    document.getElementById('btnJSON').onclick = () => exportFile('json');
    document.getElementById('btnCancel').onclick = () => document.body.removeChild(modal);
};

// Dashboard Toggles
document.getElementById('dashboardBtn').onclick = () => {
    document.getElementById('dashboardOverlay').classList.remove('hidden');
    renderDashboard();
};
document.getElementById('closeDashboardBtn').onclick = () => {
    document.getElementById('dashboardOverlay').classList.add('hidden');
};

// Start
renderColumnDropdown();
renderTable();
console.log('OneFS Explorer v2 Ready');
