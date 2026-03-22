// --- State Management ---
let rawEntries = [];
let processedEntries = [];
let filteredEntries = [];
let sortedEntries = [];
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

    // Sort Data ONCE
    sortedEntries = [...filteredEntries];
    if (sortColumn) {
        const colDef = ALL_COLUMNS.find(c => c.id === sortColumn);
        sortedEntries.sort((a, b) => {
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

    const container = document.querySelector('.table-container');
    container.scrollTop = 0;
    renderVirtualRows();
}

function renderVirtualRows() {
    const tbody = document.getElementById('tableBody');
    const container = document.querySelector('.table-container');
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;

    const ROW_HEIGHT = 35;
    const BUFFER = 10;
    const totalRows = sortedEntries.length;

    let startIndex = Math.floor(scrollTop / ROW_HEIGHT) - BUFFER;
    let endIndex = Math.floor((scrollTop + clientHeight) / ROW_HEIGHT) + BUFFER;

    startIndex = Math.max(0, startIndex);
    endIndex = Math.min(totalRows, endIndex);

    const topSpacerHeight = startIndex * ROW_HEIGHT;
    const bottomSpacerHeight = (totalRows - endIndex) * ROW_HEIGHT;

    tbody.innerHTML = '';

    const visibleCols = ALL_COLUMNS.filter(c => visibleColumnIds.has(c.id));

    if (topSpacerHeight > 0) {
        const trTop = document.createElement('tr');
        trTop.style.height = `${topSpacerHeight}px`;
        trTop.className = 'virtual-spacer';
        const td = document.createElement('td');
        td.colSpan = visibleCols.length;
        td.style.padding = 0;
        td.style.border = 'none';
        trTop.appendChild(td);
        tbody.appendChild(trTop);
    }

    for (let i = startIndex; i < endIndex; i++) {
        const entry = sortedEntries[i];
        const tr = document.createElement('tr');
        tr.style.height = `${ROW_HEIGHT}px`;
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
    }

    if (bottomSpacerHeight > 0) {
        const trBottom = document.createElement('tr');
        trBottom.style.height = `${bottomSpacerHeight}px`;
        trBottom.className = 'virtual-spacer';
        const td = document.createElement('td');
        td.colSpan = visibleCols.length;
        td.style.padding = 0;
        td.style.border = 'none';
        trBottom.appendChild(td);
        tbody.appendChild(trBottom);
    }
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

    // 4. Data Pool Aggregation
    const poolCounts = {};
    // 5. File Type Aggregation
    const typeCounts = {};
    // 6. User Flags Breakdown (individual bits)
    const flagCounts = {};

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

        // Data Pools
        if (e.data_pool !== undefined) {
            poolCounts[e.data_pool] = (poolCounts[e.data_pool] || 0) + 1;
        }

        // File Types
        if (e.file_type) {
            typeCounts[e.file_type] = (typeCounts[e.file_type] || 0) + 1;
        }

        // User Flags Breakdown
        if (Array.isArray(e.user_flags)) {
            e.user_flags.forEach(f => {
                flagCounts[f] = (flagCounts[f] || 0) + 1;
            });
        }
    });

    // Helper to generate HTML for a chart card
    function buildChartCard(title, dataObj, maxItems = 10, useBadgeColors = false) {
        // Sort descending
        const sorted = Object.entries(dataObj).sort((a, b) => b[1] - a[1]).slice(0, maxItems);
        const maxVal = sorted.length > 0 ? sorted[0][1] : 1;

        if (sorted.length === 0) return ''; // Don't show empty charts

        let html = `<div class="chart-card">
                        <h3 class="chart-title">${title}</h3>
                        <div style="display: flex; flex-direction: column; gap: 12px;">`;
        
        sorted.forEach(([label, val]) => {
            const pct = Math.max((val / maxVal) * 100, 1); // at least 1% so line is visible
            let colorVar = 'var(--accent-blue)'; // default
            
            if (useBadgeColors) {
                // Map the api string to our CSS colors manually or by extracting computed styles.
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
    container.innerHTML += buildChartCard('File Type Distribution', typeCounts, 5);
    container.innerHTML += buildChartCard('File Size Distribution', sizeBuckets, 4);
    container.innerHTML += buildChartCard('Data Pool Distribution', poolCounts, 10);
    container.innerHTML += buildChartCard('User Flags Breakdown', flagCounts, 15);
    container.innerHTML += buildChartCard('Top Churned Directories', dirCounts, 10);
}

// --- Initialization & Events ---

document.querySelector('.table-container').addEventListener('scroll', () => {
    window.requestAnimationFrame(() => renderVirtualRows());
});

function showLoading(show, message = 'Loading...') {
    let loader = document.getElementById('loaderOverlay');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loaderOverlay';
        loader.style = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;';
        loader.innerHTML = `
            <div style="width:200px;height:4px;background:#333;border-radius:2px;margin-bottom:12px;overflow:hidden;">
                <div id="loaderProgress" style="width:0;height:100%;background:var(--accent-blue);transition:width 0.2s;"></div>
            </div>
            <div id="loaderText">${message}</div>
        `;
        document.body.appendChild(loader);
    }
    loader.style.display = show ? 'flex' : 'none';
    if (show) {
        document.getElementById('loaderProgress').style.width = '0%';
        document.getElementById('loaderText').textContent = message;
    }
}

function updateLoadingProgress(pct, message) {
    const progress = document.getElementById('loaderProgress');
    const text = document.getElementById('loaderText');
    if (progress) progress.style.width = `${pct}%`;
    if (text && message) text.textContent = message;
}

async function streamParseJSON(reader, totalSize) {
    const decoder = new TextDecoder();
    let buffer = '';
    let bytesRead = 0;
    let entryCount = 0;
    
    rawEntries = [];
    processedEntries = [];
    
    // Tiny state machine to find the start of the "entries" array
    let foundEntriesStart = false;
    let depth = 0;
    let currentObjectStart = -1;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        bytesRead += value.length;
        buffer += decoder.decode(value, { stream: true });
        
        if (totalSize) {
            updateLoadingProgress((bytesRead / totalSize) * 100, `Streaming data... (${entryCount.toLocaleString()} entries)`);
        }

        // Extremely simple but memory-efficient streaming object extractor
        // We look for { ... } patterns once we are inside the entries array
        let i = 0;
        while (i < buffer.length) {
            const char = buffer[i];
            
            if (!foundEntriesStart) {
                // Look for "entries": [
                if (buffer.slice(i, i + 10) === '"entries":') {
                    foundEntriesStart = true;
                    i += 10;
                    continue;
                }
            } else {
                if (char === '{') {
                    if (depth === 0) currentObjectStart = i;
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0 && currentObjectStart !== -1) {
                        const jsonStr = buffer.slice(currentObjectStart, i + 1);
                        try {
                            const entry = JSON.parse(jsonStr);
                            rawEntries.push(entry);
                            entryCount++;
                            // Periodically process moves to keep memory flat if we wanted, 
                            // but for now we still hold processedEntries in RAM.
                        } catch (e) {
                            console.error("Partial JSON parse error", e);
                        }
                        // Advance buffer
                        buffer = buffer.slice(i + 1);
                        i = -1; // Reset loop for new buffer
                        currentObjectStart = -1;
                    }
                }
            }
            i++;
        }
        
        // Safety: if buffer gets too large without finding an object, something is wrong
        if (buffer.length > 10 * 1024 * 1024) { // 10MB safety valve
             console.warn("Buffer overflow in streaming parser");
             break;
        }
    }
}

async function loadData(dataOrStream, totalSize) {
    showLoading(true, 'Initialising...');
    
    if (dataOrStream instanceof ReadableStream) {
        await streamParseJSON(dataOrStream.getReader(), totalSize);
    } else {
        rawEntries = Array.isArray(dataOrStream) ? dataOrStream : (dataOrStream.entries || []);
    }
    
    updateLoadingProgress(90, 'Processing Move Detection...');
    // Small timeout to allow UI to show the 90% state
    await new Promise(r => setTimeout(r, 50));
    
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
    
    document.getElementById('detailsContent').innerHTML = 'Select an entry to view metadata.';
    
    applyFilters();
    buildTree();
    showLoading(false);
}

document.getElementById('demoBtn').onclick = async () => {
    try {
        const response = await fetch(demoDataUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const totalSize = parseInt(response.headers.get('content-length') || '0');
        await loadData(response.body, totalSize);
    } catch (err) {
        showLoading(false);
        alert('Failed to load demo data: ' + err.message + '\n\nNote: If you are opening this HTML file directly from your local filesystem (file:// protocol), your browser may block the fetch request due to security policies (CORS). Please use a local web server, or select the file manually via "Open File".');
    }
};

document.getElementById('fileInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
        await loadData(file.stream(), file.size);
    } catch (err) {
        showLoading(false);
        alert('Error parsing file: ' + err.message);
    }
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

document.getElementById('copyDetailsBtn').onclick = () => {
    if (!selectedEntry) return;
    const json = JSON.stringify(selectedEntry, null, 2);
    navigator.clipboard.writeText(json).then(() => {
        const btn = document.getElementById('copyDetailsBtn');
        const originalContent = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => { btn.innerHTML = originalContent; }, 2000);
    }).catch(err => {
        console.error('Failed to copy!', err);
    });
};

function initResizers() {
    const explorerResizer = document.getElementById('explorerResizer');
    const detailsResizer = document.getElementById('detailsResizer');
    const appContainer = document.querySelector('.app-container');

    let isResizing = false;
    let currentResizer = null;

    const startResize = (e, resizer) => {
        isResizing = true;
        currentResizer = resizer;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    };

    const stopResize = () => {
        if (!isResizing) return;
        isResizing = false;
        if (currentResizer) currentResizer.classList.remove('dragging');
        currentResizer = null;
        document.body.style.cursor = '';
    };

    const onResize = (e) => {
        if (!isResizing) return;

        const containerRect = appContainer.getBoundingClientRect();
        const mouseX = e.clientX;

        if (currentResizer === explorerResizer) {
            const newWidth = Math.max(150, Math.min(600, mouseX - containerRect.left));
            document.documentElement.style.setProperty('--explorer-width', `${newWidth}px`);
            localStorage.setItem('explorer-width', `${newWidth}px`);
        } else if (currentResizer === detailsResizer) {
            const newWidth = Math.max(200, Math.min(800, containerRect.right - mouseX));
            document.documentElement.style.setProperty('--details-width', `${newWidth}px`);
            localStorage.setItem('details-width', `${newWidth}px`);
        }
    };

    explorerResizer.addEventListener('mousedown', (e) => startResize(e, explorerResizer));
    detailsResizer.addEventListener('mousedown', (e) => startResize(e, detailsResizer));

    window.addEventListener('mousemove', onResize);
    window.addEventListener('mouseup', stopResize);
}

// Initialize resizers
initResizers();

function initToggles() {
    const explorerBtn = document.getElementById('toggleExplorerBtn');
    const detailsBtn = document.getElementById('toggleDetailsBtn');
    const appContainer = document.querySelector('.app-container');
    const explorerPanel = document.getElementById('explorerPanel');
    const detailsPanel = document.getElementById('detailsPanel');

    // Load saved widths
    const savedExplorerWidth = localStorage.getItem('explorer-width');
    const savedDetailsWidth = localStorage.getItem('details-width');
    if (savedExplorerWidth) document.documentElement.style.setProperty('--explorer-width', savedExplorerWidth);
    if (savedDetailsWidth) document.documentElement.style.setProperty('--details-width', savedDetailsWidth);

    const togglePane = (paneId, btn, className) => {
        const isHidden = appContainer.classList.toggle(className);
        btn.classList.toggle('active', !isHidden);
        const panel = document.getElementById(paneId);
        panel.classList.toggle('hidden', isHidden);
        localStorage.setItem(className, isHidden);
        
        // Trigger a virtual row refresh in case the table size changed significantly
        if (typeof renderVirtualRows === 'function') {
            window.requestAnimationFrame(() => renderVirtualRows());
        }
    };

    explorerBtn.onclick = () => togglePane('explorerPanel', explorerBtn, 'explorer-hidden');
    detailsBtn.onclick = () => togglePane('detailsPanel', detailsBtn, 'details-hidden');

    // Load initial states
    if (localStorage.getItem('explorer-hidden') === 'true') {
        appContainer.classList.add('explorer-hidden');
        explorerPanel.classList.add('hidden');
        explorerBtn.classList.remove('active');
    } else {
        explorerBtn.classList.add('active');
    }

    if (localStorage.getItem('details-hidden') === 'true') {
        appContainer.classList.add('details-hidden');
        detailsPanel.classList.add('hidden');
        detailsBtn.classList.remove('active');
    } else {
        detailsBtn.classList.add('active');
    }
}

// Initialize toggles
initToggles();

document.getElementById('closeDetailsBtn').onclick = (e) => {
    e.stopPropagation();
    document.querySelector('main').focus();
};

// Start
renderColumnDropdown();
renderTable();
console.log('OneFS Explorer v2 Ready (v2.1 - Toggles & Resize)');
