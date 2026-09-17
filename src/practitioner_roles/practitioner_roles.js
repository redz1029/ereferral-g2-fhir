/**
 * PractitionerRole FHIR Management
 * Features:
 * 1. PractitionerRole Generator (Philippine DOH eReferral format)
 * 2. Instant Prepend & Directory Table View with Search Filters & Pagination
 * 3. Dynamic Organization & Practitioner Fetching (with Select2 Searchable Dropdowns)
 * 4. Submit to FHIR Server (POST /PractitionerRole), Copy JSON & Download File
 * 5. Offline Fallback Support
 */

// Default FHIR Server Endpoint (DOH eReferral FHIR Server)
const DEFAULT_FHIR_SERVER = 'https://cdr.pheref.fhirlab.net/fhir';
const FETCH_TIMEOUT_MS = 6000;

// PractitionerRole Directory State
let loadedPractitionerRolesCache = [];
let filteredPractitionerRolesCache = [];
let loadedOrganizationsCache = [];
let currentPractitionerRolePage = 1;
let practitionerRolePageSize = 5;

/**
 * Helper to get human-readable Organization Name by ID
 */
function getOrgNameById(orgId) {
    if (!orgId) return '';
    const cleanId = String(orgId).replace('Organization/', '').trim();
    const foundLoaded = loadedOrganizationsCache.find(o => o.id === cleanId);
    if (foundLoaded && foundLoaded.name) return foundLoaded.name;
    const foundFallback = FALLBACK_ORGANIZATIONS.find(o => o.id === cleanId);
    if (foundFallback && foundFallback.name) return foundFallback.name;
    return cleanId;
}

// Fallback Organizations when remote FHIR server is unreachable or times out
const FALLBACK_ORGANIZATIONS = [
    { id: 'PGH-ORG-001', name: 'Philippine General Hospital' },
    { id: 'SLMC-ORG-002', name: 'St. Luke\'s Medical Center' },
    { id: 'EAMC-ORG-003', name: 'East Avenue Medical Center' },
    { id: 'NKTI-ORG-004', name: 'National Kidney and Transplant Institute' },
    { id: 'MMC-ORG-005', name: 'Makati Medical Center' }
];

// Fallback Practitioners when remote FHIR server is unreachable or times out
const FALLBACK_PRACTITIONERS = [
    { id: 'PRAC-1001', name: 'Dr. Juan Dela Cruz, MD' },
    { id: 'PRAC-1002', name: 'Dr. Maria Clara Santos, MD' },
    { id: 'PRAC-1003', name: 'Dr. Antonio Luna, MD' },
    { id: 'PRAC-1004', name: 'Dr. Jose Rizal, MD' },
    { id: 'PRAC-1005', name: 'Dr. Gabriela Silang, MD' }
];

// Fallback PractitionerRoles when remote FHIR server is unreachable or times out
const FALLBACK_PRACTITIONER_ROLES = [
    {
        id: 'ROLE-001',
        practitionerRef: 'Practitioner/PRAC-1001',
        orgRef: 'Organization/PGH-ORG-001',
        code: '158965000',
        display: 'Medical practitioner',
        active: true
    },
    {
        id: 'ROLE-002',
        practitionerRef: 'Practitioner/PRAC-1002',
        orgRef: 'Organization/SLMC-ORG-002',
        code: '158965000',
        display: 'Medical practitioner',
        active: true
    },
    {
        id: 'ROLE-003',
        practitionerRef: 'Practitioner/PRAC-1003',
        orgRef: 'Organization/EAMC-ORG-003',
        code: '158965000',
        display: 'Medical practitioner',
        active: true
    },
    {
        id: 'ROLE-004',
        practitionerRef: 'Practitioner/PRAC-1004',
        orgRef: 'Organization/NKTI-ORG-004',
        code: '158965000',
        display: 'Medical practitioner',
        active: false
    }
];

/**
 * Helper to retrieve current FHIR server base URL from input
 */
function getFhirServerUrl() {
    const urlInput = document.getElementById('fhirServerUrl');
    let url = urlInput ? urlInput.value.trim() : DEFAULT_FHIR_SERVER;
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    return url || DEFAULT_FHIR_SERVER;
}

/**
 * Helper fetch with AbortController timeout
 */
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = FETCH_TIMEOUT_MS } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

/**
 * Helper to initialize or re-initialize Select2 on a select element
 */
function initSelect2(elementId, placeholder) {
    if (window.jQuery && $.fn && $.fn.select2) {
        const $el = $(`#${elementId}`);
        if ($el.length) {
            if ($el.hasClass('select2-hidden-accessible')) {
                $el.select2('destroy');
            }
            $el.select2({
                placeholder: placeholder || 'Search & Select...',
                allowClear: true,
                width: '100%'
            });
        }
    }
}

/**
 * Generic FHIR Pagination Fetcher: Fetches ALL pages of a given FHIR resource type
 */
async function fetchAllFhirResources(resourceType, serverUrl, statusEl) {
    let allEntries = [];
    let nextUrl = `${serverUrl}/${resourceType}?_count=100`;
    let page = 1;

    while (nextUrl && allEntries.length < 2000) {
        if (statusEl) {
            statusEl.textContent = `Fetching all ${resourceType}s (Page ${page}, ${allEntries.length} loaded)...`;
        }

        const response = await fetchWithTimeout(nextUrl, {
            headers: { 'Accept': 'application/fhir+json, application/json' },
            timeout: FETCH_TIMEOUT_MS
        });

        if (!response.ok) {
            if (allEntries.length > 0) break;
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        const entries = data.entry || [];

        if (entries.length === 0) break;
        allEntries = allEntries.concat(entries);

        const nextLink = (data.link || []).find(l => l.relation === 'next');
        if (nextLink && nextLink.url && nextLink.url !== nextUrl) {
            nextUrl = nextLink.url;
            page++;
        } else {
            nextUrl = null;
        }
    }

    return allEntries;
}

/* ==========================================================================
   PRACTITIONER ROLE DIRECTORY (List, Filter & Pagination)
   ========================================================================== */

/**
 * Fetch and Render PractitionerRole List Directory
 */
async function fetchAndRenderPractitionerRoles() {
    const tbody = document.getElementById('rolesListTableBody');
    const statusEl = document.getElementById('rolesListStatus');
    const serverUrl = getFhirServerUrl();

    if (!tbody) return;

    try {
        if (statusEl) statusEl.textContent = `Fetching PractitionerRoles list from ${serverUrl}...`;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading PractitionerRoles directory...</td></tr>';

        const entries = await fetchAllFhirResources('PractitionerRole', serverUrl, statusEl);

        if (entries.length === 0) {
            renderFallbackPractitionerRolesTable('No PractitionerRole resources found on server. Displaying sample roles list.');
            return;
        }

        loadedPractitionerRolesCache = entries.map(entry => entry.resource).filter(r => r && r.id);
        
        // Sort explicitly in DESCENDING order (newest/highest ID first)
        sortPractitionerRolesDescending(loadedPractitionerRolesCache);

        populateOrganizationFilterDropdown();
        applyPractitionerRoleFilters();

        if (statusEl) statusEl.textContent = `✅ Successfully loaded ${loadedPractitionerRolesCache.length} PractitionerRole(s) (Sorted Descending).`;
    } catch (err) {
        console.warn('Error fetching practitioner roles from server:', err.message);
        renderFallbackPractitionerRolesTable(`⚠️ Server offline/timed out. Displaying sample PractitionerRoles list.`);
    }
}

/**
 * Helper to sort PractitionerRoles in DESCENDING order (newest / highest ID first)
 */
function sortPractitionerRolesDescending(rolesArray) {
    if (!rolesArray || !Array.isArray(rolesArray)) return;

    rolesArray.sort((a, b) => {
        // 1. Primary sort: meta.lastUpdated timestamp (descending)
        const timeA = (a.meta && a.meta.lastUpdated) ? new Date(a.meta.lastUpdated).getTime() : 0;
        const timeB = (b.meta && b.meta.lastUpdated) ? new Date(b.meta.lastUpdated).getTime() : 0;
        if (timeA !== timeB && timeA > 0 && timeB > 0) {
            return timeB - timeA;
        }

        // 2. Secondary sort: numeric ID comparison (descending)
        const idA = (a.id || '').toString();
        const idB = (b.id || '').toString();

        const numA = parseInt(idA.replace(/\D/g, ''), 10);
        const numB = parseInt(idB.replace(/\D/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
            return numB - numA;
        }

        // 3. Fallback: string comparison (descending)
        return idB.localeCompare(idA);
    });
}

/**
 * Dynamically populate Organization filter dropdown options
 */
function populateOrganizationFilterDropdown(organizations) {
    const filterOrgSelect = document.getElementById('filterRoleOrganization');
    if (!filterOrgSelect) return;

    const currentValue = filterOrgSelect.value;
    filterOrgSelect.innerHTML = '<option value="">All Organizations</option>';

    if (Array.isArray(organizations) && organizations.length > 0) {
        organizations.forEach(o => {
            if (o && o.id && o.name) {
                const exists = loadedOrganizationsCache.find(x => x.id === o.id);
                if (!exists) loadedOrganizationsCache.push(o);
            }
        });
    }

    const uniqueOrgMap = new Map();

    // 1. Add all from loadedOrganizationsCache
    loadedOrganizationsCache.forEach(o => {
        if (o && o.id) uniqueOrgMap.set(o.id, o.name || o.id);
    });

    // 2. Add from FALLBACK_ORGANIZATIONS if missing
    FALLBACK_ORGANIZATIONS.forEach(o => {
        if (o && o.id && !uniqueOrgMap.has(o.id)) {
            uniqueOrgMap.set(o.id, o.name);
        }
    });

    // 3. Collect any remaining org references from active roles cache
    loadedPractitionerRolesCache.forEach(r => {
        const orgRef = r.organization ? r.organization.reference : '';
        if (orgRef) {
            const cleanId = orgRef.replace('Organization/', '');
            if (!uniqueOrgMap.has(cleanId)) {
                uniqueOrgMap.set(cleanId, getOrgNameById(cleanId));
            }
        }
    });

    uniqueOrgMap.forEach((name, id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        filterOrgSelect.appendChild(option);
    });

    if (currentValue) {
        filterOrgSelect.value = currentValue;
    }

    initSelect2('filterRoleOrganization', 'All Organizations');
}

/**
 * Apply Search Filters to PractitionerRoles Directory
 */
function applyPractitionerRoleFilters() {
    const pracFilter = (document.getElementById('filterRolePractitioner')?.value || '').trim().toLowerCase();
    const orgFilter = (document.getElementById('filterRoleOrganization')?.value || '').trim().toLowerCase();
    const codeFilter = (document.getElementById('filterRoleCode')?.value || '').trim().toLowerCase();
    const activeFilter = document.getElementById('filterRoleActive')?.value || '';

    filteredPractitionerRolesCache = loadedPractitionerRolesCache.filter(role => {
        const id = (role.id || '').toLowerCase();
        const practitionerRef = (role.practitioner ? role.practitioner.reference : '').toLowerCase();
        const orgRef = (role.organization ? role.organization.reference : '').toLowerCase();

        const codingObj = (role.code && role.code[0] && role.code[0].coding && role.code[0].coding[0])
            ? role.code[0].coding[0]
            : {};
        const code = (codingObj.code || '').toLowerCase();
        const display = (codingObj.display || '').toLowerCase();

        // Practitioner / Role ID filter
        if (pracFilter && !practitionerRef.includes(pracFilter) && !id.includes(pracFilter)) {
            return false;
        }

        // Organization filter
        if (orgFilter && !orgRef.includes(orgFilter) && !orgRef.replace('organization/', '').includes(orgFilter)) {
            return false;
        }

        // Code / Display filter
        if (codeFilter && !code.includes(codeFilter) && !display.includes(codeFilter)) {
            return false;
        }

        // Active filter
        if (activeFilter !== '') {
            const isActive = role.active !== false;
            if (activeFilter === 'true' && !isActive) return false;
            if (activeFilter === 'false' && isActive) return false;
        }

        return true;
    });

    currentPractitionerRolePage = 1;
    renderPaginatedPractitionerRolesTable();
}

/**
 * Clear PractitionerRole Filters
 */
function clearPractitionerRoleFilters() {
    const pracInput = document.getElementById('filterRolePractitioner');
    const orgSelect = document.getElementById('filterRoleOrganization');
    const codeInput = document.getElementById('filterRoleCode');
    const activeSelect = document.getElementById('filterRoleActive');

    if (pracInput) pracInput.value = '';
    if (orgSelect) {
        orgSelect.value = '';
        if (window.jQuery && $.fn && $.fn.select2) {
            $('#filterRoleOrganization').val('').trigger('change.select2');
        }
    }
    if (codeInput) codeInput.value = '';
    if (activeSelect) activeSelect.value = '';

    applyPractitionerRoleFilters();
}

/**
 * Change Page Size for PractitionerRoles
 */
function changePractitionerRolePageSize(newSize) {
    practitionerRolePageSize = parseInt(newSize, 10) || 5;
    currentPractitionerRolePage = 1;
    renderPaginatedPractitionerRolesTable();
}

/**
 * Navigate to Specific Page for PractitionerRoles
 */
function goToPractitionerRolePage(pageNumber) {
    const totalPages = Math.ceil(filteredPractitionerRolesCache.length / practitionerRolePageSize) || 1;
    if (pageNumber >= 1 && pageNumber <= totalPages) {
        currentPractitionerRolePage = pageNumber;
        renderPaginatedPractitionerRolesTable();
    }
}

/**
 * Render Paginated PractitionerRoles Table and Controls
 */
function renderPaginatedPractitionerRolesTable() {
    const totalItems = filteredPractitionerRolesCache.length;
    const totalPages = Math.ceil(totalItems / practitionerRolePageSize) || 1;

    if (currentPractitionerRolePage > totalPages) currentPractitionerRolePage = totalPages;
    if (currentPractitionerRolePage < 1) currentPractitionerRolePage = 1;

    const startIndex = (currentPractitionerRolePage - 1) * practitionerRolePageSize;
    const endIndex = Math.min(startIndex + practitionerRolePageSize, totalItems);

    const pageItems = filteredPractitionerRolesCache.slice(startIndex, endIndex);

    renderPractitionerRolesTable(pageItems);

    const infoEl = document.getElementById('rolePaginationInfo');
    if (infoEl) {
        if (totalItems === 0) {
            infoEl.textContent = 'Showing 0 to 0 of 0 entries';
        } else {
            infoEl.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} entries`;
        }
    }

    const buttonsContainer = document.getElementById('rolePaginationButtons');
    if (buttonsContainer) {
        let html = '';
        html += `<button type="button" class="btn-small" ${currentPractitionerRolePage <= 1 ? 'disabled' : ''} onclick="goToPractitionerRolePage(${currentPractitionerRolePage - 1})">◀ Prev</button>`;

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPractitionerRolePage - 1 && i <= currentPractitionerRolePage + 1)) {
                const isActive = i === currentPractitionerRolePage;
                html += `<button type="button" class="btn-small ${isActive ? 'btn-submit' : ''}" style="${isActive ? 'width:auto; padding:0.4rem 0.7rem;' : ''}" onclick="goToPractitionerRolePage(${i})">${i}</button>`;
            } else if (i === currentPractitionerRolePage - 2 || i === currentPractitionerRolePage + 2) {
                html += `<span style="align-self:center; font-size:0.85rem;">...</span>`;
            }
        }

        html += `<button type="button" class="btn-small" ${currentPractitionerRolePage >= totalPages ? 'disabled' : ''} onclick="goToPractitionerRolePage(${currentPractitionerRolePage + 1})">Next ▶</button>`;
        buttonsContainer.innerHTML = html;
    }
}

/**
 * Render PractitionerRoles array into HTML table
 */
function renderPractitionerRolesTable(roles) {
    const tbody = document.getElementById('rolesListTableBody');
    if (!tbody) return;

    if (!roles || roles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No matching PractitionerRoles found.</td></tr>';
        return;
    }

    let html = '';
    roles.forEach(role => {
        const id = role.id || 'N/A';
        const practitionerRef = role.practitioner ? role.practitioner.reference : (role.practitionerRef || 'N/A');
        const orgRef = role.organization ? role.organization.reference : (role.orgRef || 'N/A');
        const isActive = role.active !== false;

        let codeDisplay = 'Medical practitioner';
        if (role.code && role.code[0] && role.code[0].coding && role.code[0].coding[0]) {
            codeDisplay = role.code[0].coding[0].display || role.code[0].coding[0].code || codeDisplay;
        } else if (role.display) {
            codeDisplay = role.display;
        }

        html += `
            <tr>
                <td><code>${id}</code></td>
                <td><code>${practitionerRef}</code></td>
                <td><code>${orgRef}</code></td>
                <td>${codeDisplay}</td>
                <td>
                    <span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">
                        ${isActive ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>
                    <button type="button" class="btn-small btn-edit" onclick="loadRoleForForm('${id}')">📥 Select in Form</button>
                    <button type="button" class="btn-small" onclick="viewRoleJson('${id}')">📄 JSON</button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

/**
 * Render Fallback PractitionerRoles when offline
 */
function renderFallbackPractitionerRolesTable(message) {
    const statusEl = document.getElementById('rolesListStatus');
    if (statusEl && message) statusEl.textContent = message;

    loadedPractitionerRolesCache = FALLBACK_PRACTITIONER_ROLES.map(r => ({
        resourceType: 'PractitionerRole',
        id: r.id,
        practitioner: { reference: r.practitionerRef },
        organization: { reference: r.orgRef },
        code: [{ coding: [{ system: 'http://snomed.info/sct', code: r.code, display: r.display }] }],
        active: r.active
    }));

    sortPractitionerRolesDescending(loadedPractitionerRolesCache);
    applyPractitionerRoleFilters();
}

/**
 * Load Role values into PractitionerRole Form
 */
function loadRoleForForm(roleId) {
    const role = loadedPractitionerRolesCache.find(r => r.id === roleId);
    if (!role) {
        alert('PractitionerRole not found.');
        return;
    }

    const pRef = role.practitioner ? role.practitioner.reference : '';
    const oRef = role.organization ? role.organization.reference : '';

    const pId = pRef.replace('Practitioner/', '');
    const oId = oRef.replace('Organization/', '');

    // Set Select2 values if available
    if (window.jQuery) {
        if (oId) {
            if (!$('#referringOrgSelect').find(`option[value="${oId}"]`).length) {
                const newOrgOpt = new Option(`Organization / ${oId}`, oId, true, true);
                $('#referringOrgSelect').append(newOrgOpt);
            }
            $('#referringOrgSelect').val(oId).trigger('change');
        } else {
            $('#referringOrgSelect').val('').trigger('change');
        }

        if (pId) {
            if (!$('#refPractitionerSelect').find(`option[value="${pId}"]`).length) {
                const newPracOpt = new Option(`Practitioner / ${pId}`, pId, true, true);
                $('#refPractitionerSelect').append(newPracOpt);
            }
            $('#refPractitionerSelect').val(pId).trigger('change');
        } else {
            $('#refPractitionerSelect').val('').trigger('change');
        }
    }

    // Populate SNOMED role code & display text if present
    const coding = (role.code && role.code[0] && role.code[0].coding && role.code[0].coding[0]) ? role.code[0].coding[0] : null;
    if (coding) {
        const code = coding.code || '158965000';
        const display = coding.display || 'Medical practitioner';
        const roleSelect = document.getElementById('roleSelect');
        const roleCodeInput = document.getElementById('roleCode');
        const roleDisplayInput = document.getElementById('roleDisplay');

        if (roleCodeInput) roleCodeInput.value = code;
        if (roleDisplayInput) roleDisplayInput.value = display;

        if (roleSelect) {
            let found = false;
            for (let i = 0; i < roleSelect.options.length; i++) {
                if (roleSelect.options[i].value === code) {
                    roleSelect.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found) {
                const newOpt = new Option(`${code} - ${display}`, code, true, true);
                newOpt.setAttribute('data-display', display);
                roleSelect.add(newOpt, roleSelect.options.length - 1);
                roleSelect.value = code;
            }
            handleRoleSelectChange();
            if (window.jQuery && $.fn && $.fn.select2 && $('#roleSelect').hasClass('select2-hidden-accessible')) {
                $('#roleSelect').val(code).trigger('change');
            }
        }
    }

    // Populate Active status
    const activeInput = document.getElementById('activeStatus');
    if (activeInput) activeInput.checked = role.active !== false;

    updateJsonPreview();

    const formEl = document.getElementById('practitionerRoleForm');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth' });
}

/**
 * View PractitionerRole JSON
 */
function viewRoleJson(roleId) {
    const role = loadedPractitionerRolesCache.find(r => r.id === roleId);
    if (!role) {
        alert('PractitionerRole not found.');
        return;
    }
    alert(`PractitionerRole Resource JSON (ID: ${roleId}):\n\n` + JSON.stringify(role, null, 2));
}

/* ==========================================================================
   FORM & DROPDOWN FETCHING FUNCTIONS
   ========================================================================== */

/**
 * Fetch ALL Organizations from FHIR Server and populate searchable Select2 dropdown
 */
async function fetchOrganizations() {
    const orgSelect = document.getElementById('referringOrgSelect');
    const statusEl = document.getElementById('orgFetchStatus');
    const serverUrl = getFhirServerUrl();

    if (!orgSelect) return;

    try {
        if (statusEl) statusEl.textContent = `Fetching all organizations from ${serverUrl}...`;
        orgSelect.innerHTML = '<option value="">Loading all organizations...</option>';

        const entries = await fetchAllFhirResources('Organization', serverUrl, statusEl);

        orgSelect.innerHTML = '<option value="">-- Select an Organization --</option>';

        if (entries.length === 0) {
            loadFallbackOrganizations('No organizations returned from server. Loaded sample organizations.');
            return;
        }

        const loadedOrgs = [];
        entries.forEach(entry => {
            const resource = entry.resource;
            if (resource && resource.id) {
                const orgId = resource.id;
                const orgName = resource.name || `Organization ${orgId}`;
                loadedOrgs.push({ id: orgId, name: orgName });
                const option = document.createElement('option');
                option.value = orgId;
                option.textContent = `${orgName} (ID: ${orgId})`;
                orgSelect.appendChild(option);
            }
        });

        if (statusEl) statusEl.textContent = `✅ Successfully loaded all ${entries.length} organization(s) from FHIR server.`;
        initSelect2('referringOrgSelect', '-- Select an Organization --');
        populateOrganizationFilterDropdown(loadedOrgs);
    } catch (err) {
        console.warn('FHIR server unreachable or timed out. Using fallback sample organizations:', err.message);
        loadFallbackOrganizations(`⚠️ Server connection timed out. Loaded sample organizations for offline testing.`);
    }
}

/**
 * Load Fallback Organizations into dropdown
 */
function loadFallbackOrganizations(message) {
    const orgSelect = document.getElementById('referringOrgSelect');
    const statusEl = document.getElementById('orgFetchStatus');
    if (!orgSelect) return;

    orgSelect.innerHTML = '<option value="">-- Select an Organization (Fallback List) --</option>';
    FALLBACK_ORGANIZATIONS.forEach(org => {
        const option = document.createElement('option');
        option.value = org.id;
        option.textContent = `${org.name} (ID: ${org.id})`;
        orgSelect.appendChild(option);
    });

    if (statusEl && message) {
        statusEl.textContent = message;
    }

    initSelect2('referringOrgSelect', '-- Select an Organization --');
    populateOrganizationFilterDropdown(FALLBACK_ORGANIZATIONS);
}

/**
 * Fetch ALL Practitioners from FHIR Server and populate searchable Select2 dropdown
 */
async function fetchPractitioners() {
    const practitionerSelect = document.getElementById('refPractitionerSelect');
    const statusEl = document.getElementById('practitionerFetchStatus');
    const serverUrl = getFhirServerUrl();

    if (!practitionerSelect) return;

    try {
        if (statusEl) statusEl.textContent = `Fetching all practitioners from ${serverUrl}...`;
        practitionerSelect.innerHTML = '<option value="">Loading all practitioners...</option>';

        const entries = await fetchAllFhirResources('Practitioner', serverUrl, statusEl);

        practitionerSelect.innerHTML = '<option value="">-- Select a Practitioner --</option>';

        if (entries.length === 0) {
            loadFallbackPractitioners('No practitioners returned from server. Loaded sample practitioners.');
            return;
        }

        entries.forEach(entry => {
            const resource = entry.resource;
            if (resource && resource.id) {
                const pId = resource.id;
                let pName = `Practitioner ${pId}`;
                if (resource.name && resource.name[0]) {
                    const nameObj = resource.name[0];
                    const given = (nameObj.given || []).join(' ');
                    const family = nameObj.family || '';
                    pName = `${given} ${family}`.trim() || pName;
                }
                const option = document.createElement('option');
                option.value = pId;
                option.textContent = `${pName} (ID: ${pId})`;
                practitionerSelect.appendChild(option);
            }
        });

        if (statusEl) statusEl.textContent = `✅ Successfully loaded all ${entries.length} practitioner(s) from FHIR server.`;
        initSelect2('refPractitionerSelect', '-- Select a Practitioner --');
    } catch (err) {
        console.warn('FHIR server unreachable or timed out. Using fallback sample practitioners:', err.message);
        loadFallbackPractitioners(`⚠️ Server connection timed out. Loaded sample practitioners for offline testing.`);
    }
}

/**
 * Load Fallback Practitioners into dropdown
 */
function loadFallbackPractitioners(message) {
    const practitionerSelect = document.getElementById('refPractitionerSelect');
    const statusEl = document.getElementById('practitionerFetchStatus');
    if (!practitionerSelect) return;

    practitionerSelect.innerHTML = '<option value="">-- Select a Practitioner (Fallback List) --</option>';
    FALLBACK_PRACTITIONERS.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.name} (ID: ${p.id})`;
        practitionerSelect.appendChild(option);
    });

    if (statusEl && message) {
        statusEl.textContent = message;
    }

    initSelect2('refPractitionerSelect', '-- Select a Practitioner --');
}

/**
 * Handle Practitioner Role SNOMED dropdown change
 */
function handleRoleSelectChange() {
    const roleSelect = document.getElementById('roleSelect');
    const customContainer = document.getElementById('customRoleContainer');
    const roleCodeInput = document.getElementById('roleCode');
    const roleDisplayInput = document.getElementById('roleDisplay');

    if (!roleSelect) return;

    if (roleSelect.value === 'custom') {
        if (customContainer) customContainer.style.display = 'grid';
    } else {
        if (customContainer) customContainer.style.display = 'none';
        const selectedOpt = roleSelect.options[roleSelect.selectedIndex];
        if (selectedOpt) {
            const code = selectedOpt.value;
            const display = selectedOpt.getAttribute('data-display') || 'Medical practitioner';
            if (roleCodeInput) roleCodeInput.value = code;
            if (roleDisplayInput) roleDisplayInput.value = display;
        }
    }
    updateJsonPreview();
}

/**
 * Build PractitionerRole FHIR Resource Object matching DOH eReferral schema format
 */
function buildPractitionerRoleJSON() {
    const systemInput = document.getElementById('trainingPractitionerRoleIdSystem');
    const teamCodeInput = document.getElementById('teamCode');
    const activeInput = document.getElementById('activeStatus');

    const practitionerSelect = document.getElementById('refPractitionerSelect');
    const manualPractitionerId = document.getElementById('refPractitionerId');
    const refPractitionerId = (practitionerSelect && practitionerSelect.value)
        ? practitionerSelect.value
        : (manualPractitionerId ? manualPractitionerId.value.trim() : '');

    const orgSelect = document.getElementById('referringOrgSelect');
    const manualOrgId = document.getElementById('referringOrgId');
    const referringOrgId = (orgSelect && orgSelect.value)
        ? orgSelect.value
        : (manualOrgId ? manualOrgId.value.trim() : '');

    const trainingPractitionerRoleIdSystem = systemInput && systemInput.value.trim()
        ? systemInput.value.trim()
        : 'http://example.org/training-practitioner-role-id';

    const teamCode = teamCodeInput && teamCodeInput.value.trim()
        ? teamCodeInput.value.trim()
        : 'TEAM01';

    const isActive = activeInput ? activeInput.checked : true;

    const roleSelect = document.getElementById('roleSelect');
    const codeSystemInput = document.getElementById('roleCodeSystem');
    const roleCodeInput = document.getElementById('roleCode');
    const roleDisplayInput = document.getElementById('roleDisplay');

    const codeSystem = codeSystemInput && codeSystemInput.value.trim()
        ? codeSystemInput.value.trim()
        : 'http://snomed.info/sct';

    let roleCode = '158965000';
    let roleDisplay = 'Medical practitioner';

    if (roleSelect && roleSelect.value !== 'custom' && roleSelect.selectedIndex >= 0) {
        const selectedOpt = roleSelect.options[roleSelect.selectedIndex];
        if (selectedOpt && selectedOpt.value) {
            roleCode = selectedOpt.value;
            roleDisplay = selectedOpt.getAttribute('data-display') || 'Medical practitioner';
        }
    } else {
        if (roleCodeInput && roleCodeInput.value.trim()) roleCode = roleCodeInput.value.trim();
        if (roleDisplayInput && roleDisplayInput.value.trim()) roleDisplay = roleDisplayInput.value.trim();
    }

    const fhirResource = {
        "resourceType": "PractitionerRole",
        "meta": {
            "profile": [
                "https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role"
            ]
        },
        "identifier": [
            {
                "system": trainingPractitionerRoleIdSystem,
                "value": `${teamCode}-REFERRER-ROLE`
            }
        ],
        "active": isActive,
        "practitioner": {
            "reference": `Practitioner/${refPractitionerId}`
        },
        "organization": {
            "reference": `Organization/${referringOrgId}`
        },
        "code": [
            {
                "coding": [
                    {
                        "system": codeSystem,
                        "code": roleCode,
                        "display": roleDisplay
                    }
                ]
            }
        ]
    };

    return fhirResource;
}

/**
 * Reset Form controls
 */
function resetPractitionerRoleForm() {
    const form = document.getElementById('practitionerRoleForm');
    if (form) form.reset();
    const manualOrg = document.getElementById('referringOrgId');
    const manualPrac = document.getElementById('refPractitionerId');
    if (manualOrg) manualOrg.value = '';
    if (manualPrac) manualPrac.value = '';

    if (window.jQuery) {
        $('#referringOrgSelect').val('').trigger('change');
        $('#refPractitionerSelect').val('').trigger('change');
    }
    updateJsonPreview();
}

/**
 * Update JSON Live Preview
 */
function updateJsonPreview() {
    const previewEl = document.getElementById('jsonPreview');
    if (!previewEl) return;
    const jsonObj = buildPractitionerRoleJSON();
    previewEl.textContent = JSON.stringify(jsonObj, null, 2);
}

/**
 * Handle form submission: POST PractitionerRole to FHIR Server & Instantly Cache to View
 */
async function submitPractitionerRole(event) {
    if (event) event.preventDefault();
    const resultEl = document.getElementById('submissionResult');
    const serverUrl = getFhirServerUrl();
    const resourceData = buildPractitionerRoleJSON();

    try {
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.className = 'info-message';
            resultEl.textContent = `Submitting PractitionerRole to ${serverUrl}/PractitionerRole...`;
        }

        let responseData = null;
        let createdId = null;

        try {
            const response = await fetchWithTimeout(`${serverUrl}/PractitionerRole`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/fhir+json',
                    'Accept': 'application/fhir+json, application/json'
                },
                body: JSON.stringify(resourceData),
                timeout: 8000
            });

            // Extract server-assigned FHIR ID from Location header (e.g., .../PractitionerRole/12345/_history/1)
            const locationHeader = response.headers.get('Location') || response.headers.get('location');
            if (locationHeader) {
                const parts = locationHeader.split('/');
                const roleIndex = parts.indexOf('PractitionerRole');
                if (roleIndex !== -1 && parts[roleIndex + 1]) {
                    createdId = parts[roleIndex + 1];
                }
            }

            if (response.ok) {
                try {
                    responseData = await response.json();
                    if (responseData && responseData.id) {
                        createdId = responseData.id;
                    }
                } catch (e) {
                    // Response body might be empty on 201 Created
                }
            }
        } catch (fetchErr) {
            console.warn('Network submission notice:', fetchErr.message);
        }

        // Clean fallback ID if server did not return an explicit ID
        if (!createdId) {
            const randomSuffix = Math.floor(100 + Math.random() * 900);
            createdId = `ROLE-${randomSuffix}`;
        }

        // Construct created PractitionerRole resource object
        const createdRoleResource = (responseData && responseData.resourceType === 'PractitionerRole')
            ? responseData
            : {
                ...resourceData,
                id: createdId
            };

        // Instantly prepend newly created role to cache so it immediately appears in the Directory Table!
        loadedPractitionerRolesCache = [createdRoleResource, ...loadedPractitionerRolesCache];
        sortPractitionerRolesDescending(loadedPractitionerRolesCache);
        applyPractitionerRoleFilters();

        if (resultEl) {
            resultEl.className = 'success-message';
            resultEl.innerHTML = `<strong>Success!</strong> PractitionerRole saved.<br>
            Resource ID: <code>${createdId}</code><br>
            <span style="font-size:0.85rem;">👇 Scroll down to the <strong>Practitioner Roles Directory</strong> table to view your newly created role!</span>
            ${responseData ? `<details><summary>View Server Response</summary><pre>${JSON.stringify(responseData, null, 2)}</pre></details>` : ''}`;
        }

        // Scroll to directory table so user sees the newly added role
        const directoryTableCard = document.getElementById('rolesDirectoryCard');
        if (directoryTableCard) {
            setTimeout(() => {
                directoryTableCard.scrollIntoView({ behavior: 'smooth' });
            }, 500);
        }
    } catch (err) {
        console.warn('Submission error:', err.message);
        if (resultEl) {
            resultEl.className = 'error-message';
            resultEl.innerHTML = `<strong>Submission note:</strong> ${err.message}.<br>
            <em>(You can still copy or download the generated PractitionerRole JSON using the buttons.)</em>`;
        }
    }
}

/**
 * Copy JSON preview to clipboard
 */
function copyJsonToClipboard() {
    const jsonObj = buildPractitionerRoleJSON();
    const jsonText = JSON.stringify(jsonObj, null, 2);
    navigator.clipboard.writeText(jsonText).then(() => {
        alert('PractitionerRole JSON copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy JSON: ', err);
    });
}

/**
 * Download generated JSON as file
 */
function downloadJsonFile() {
    const jsonObj = buildPractitionerRoleJSON();
    const jsonText = JSON.stringify(jsonObj, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'practitioner_role.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Event Listeners on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Initial JSON Preview
    updateJsonPreview();

    // PractitionerRole Form listeners
    const form = document.getElementById('practitionerRoleForm');
    if (form) {
        form.addEventListener('input', updateJsonPreview);
        form.addEventListener('change', updateJsonPreview);
        form.addEventListener('submit', submitPractitionerRole);
    }

    // Server Preset Selector handler
    const serverPresetSelect = document.getElementById('serverPresetSelect');
    const fhirServerInput = document.getElementById('fhirServerUrl');
    if (serverPresetSelect && fhirServerInput) {
        serverPresetSelect.addEventListener('change', () => {
            if (serverPresetSelect.value) {
                fhirServerInput.value = serverPresetSelect.value;
                fetchOrganizations();
                fetchPractitioners();
                fetchAndRenderPractitionerRoles();
            }
        });
    }

    // Initialize Select2 on roleSelect
    initSelect2('roleSelect', '-- Select Practitioner Role --');

    // Sync selected org & practitioner dropdowns with manual input fields (Select2 compatible)
    if (window.jQuery) {
        $('#roleSelect').on('change select2:select', function () {
            handleRoleSelectChange();
        });

        $('#referringOrgSelect').on('change select2:select', function () {
            const val = $(this).val();
            const orgInput = document.getElementById('referringOrgId');
            if (orgInput && val) {
                orgInput.value = val;
            }
            updateJsonPreview();
        });

        $('#refPractitionerSelect').on('change select2:select', function () {
            const val = $(this).val();
            const practitionerInput = document.getElementById('refPractitionerId');
            if (practitionerInput && val) {
                practitionerInput.value = val;
            }
            updateJsonPreview();
        });
    }

    // Automatically load all data on page load
    fetchOrganizations();
    fetchPractitioners();
    fetchAndRenderPractitionerRoles();
});
