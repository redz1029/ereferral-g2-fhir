/**
 * FHIR e-Referral Module (Philippine DOH PHeReF Standard)
 * Features:
 * 1. Dynamic Patient, Sending Facility, PractitionerRole, and Receiving Facility Selection (Select2)
 * 2. ICD-10 Diagnosis Coding & Vital Signs Observations (LOINC)
 * 3. Bulk Saving via FHIR Transaction Bundle (POST /)
 * 4. Real-time JSON Bundle Preview, Copy & Download
 * 5. Descending Order Directory View with Live Filters & Pagination
 */

const DEFAULT_FHIR_SERVER = 'https://cdr.pheref.fhirlab.net/fhir';
const FETCH_TIMEOUT_MS = 25000;

// State Cache
let loadedReferralsCache = [];
let filteredReferralsCache = [];
let currentReferralPage = 1;
let referralPageSize = 5;

let loadedPatientsCache = [];
let loadedOrganizationsCache = [];
let loadedPractitionerRolesCache = [];

// Fallback Patients
const FALLBACK_PATIENTS = [
    { id: '1001', name: 'Dela Cruz, Juan', gender: 'male', birthDate: '1985-06-15' },
    { id: '1002', name: 'Santos, Maria Clara', gender: 'female', birthDate: '1990-11-20' },
    { id: '1003', name: 'Luna, Antonio', gender: 'male', birthDate: '1978-04-12' },
    { id: '1004', name: 'Rizal, Jose', gender: 'male', birthDate: '1982-01-30' },
    { id: '1005', name: 'Silang, Gabriela', gender: 'female', birthDate: '1995-09-08' }
];

// Fallback Organizations
const FALLBACK_ORGANIZATIONS = [
    { id: 'PGH-ORG-001', name: 'Philippine General Hospital' },
    { id: 'SLMC-ORG-002', name: 'St. Luke\'s Medical Center' },
    { id: 'EAMC-ORG-003', name: 'East Avenue Medical Center' },
    { id: 'NKTI-ORG-004', name: 'National Kidney and Transplant Institute' },
    { id: 'MMC-ORG-005', name: 'Makati Medical Center' }
];

// Fallback PractitionerRoles
const FALLBACK_PRACTITIONER_ROLES = [
    { id: 'ROLE-001', display: 'Dr. Juan Dela Cruz (Medical practitioner @ PGH)', orgRef: 'Organization/PGH-ORG-001' },
    { id: 'ROLE-002', display: 'Dr. Maria Clara Santos (Medical practitioner @ SLMC)', orgRef: 'Organization/SLMC-ORG-002' },
    { id: 'ROLE-003', display: 'Dr. Antonio Luna (Surgeon @ EAMC)', orgRef: 'Organization/EAMC-ORG-003' }
];

// Fallback e-Referrals
const FALLBACK_REFERRALS = [
    {
        id: 'REF-2026-001',
        patientRef: 'Patient/1001',
        patientName: 'Dela Cruz, Juan',
        sendingOrgRef: 'Organization/PGH-ORG-001',
        sendingRoleRef: 'PractitionerRole/ROLE-001',
        receivingOrgRef: 'Organization/SLMC-ORG-002',
        receivingRoleRef: 'PractitionerRole/ROLE-002',
        chiefComplaint: 'Persistent high fever and severe headache for 3 days',
        icdCode: 'I10',
        icdDisplay: 'Essential (primary) hypertension',
        priority: 'urgent',
        note: 'Patient requires urgent specialized cardiology evaluation.',
        authoredOn: '2026-09-17T08:00:00.000Z',
        lastUpdated: '2026-09-17T08:00:00.000Z',
        timestamp: '2026-09-17T08:00:00.000Z'
    },
    {
        id: 'REF-2026-002',
        patientRef: 'Patient/1002',
        patientName: 'Santos, Maria Clara',
        sendingOrgRef: 'Organization/SLMC-ORG-002',
        sendingRoleRef: 'PractitionerRole/ROLE-002',
        receivingOrgRef: 'Organization/NKTI-ORG-004',
        receivingRoleRef: '',
        chiefComplaint: 'Frequent urination and excessive thirst',
        icdCode: 'E11.9',
        icdDisplay: 'Type 2 diabetes mellitus without complications',
        priority: 'routine',
        note: 'Routine endocrinology referral for blood sugar optimization.',
        authoredOn: '2026-09-16T14:30:00.000Z',
        lastUpdated: '2026-09-16T14:30:00.000Z',
        timestamp: '2026-09-16T14:30:00.000Z'
    }
];

/**
 * Helper to retrieve current FHIR server base URL
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
 * Helper to generate valid RFC4122 v4 UUID for FHIR fullUrl
 */
function generateUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return 'urn:uuid:' + crypto.randomUUID();
    }
    return 'urn:uuid:' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
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
 * Helper to extract resource ID from reference or URL
 */
function extractResourceTargetId(refStr) {
    if (!refStr) return '';
    let str = String(refStr).trim();
    if (str.includes('/')) {
        const parts = str.split('/');
        str = parts[parts.length - 1];
    }
    return str.trim().toLowerCase();
}

/**
 * Helper to get human-readable Organization Name by ID
 */
function getOrgNameById(orgId) {
    if (!orgId) return 'N/A';
    const cleanId = String(orgId).replace('Organization/', '').trim();
    const foundLoaded = loadedOrganizationsCache.find(o => o.id === cleanId);
    if (foundLoaded && foundLoaded.name) return foundLoaded.name;
    const foundFallback = FALLBACK_ORGANIZATIONS.find(o => o.id === cleanId);
    if (foundFallback && foundFallback.name) return foundFallback.name;
    return cleanId;
}

/**
 * Helper to render FHIR ServiceRequest status badge
 */
function getStatusBadgeHtml(status) {
    const sLower = (status || 'active').toLowerCase();
    if (sLower === 'completed') {
        return `<span class="badge" style="background:#dbeafe; color:#1e40af;">COMPLETED</span>`;
    } else if (sLower === 'on-hold') {
        return `<span class="badge" style="background:#fef3c7; color:#92400e;">ON-HOLD</span>`;
    } else if (sLower === 'revoked') {
        return `<span class="badge badge-danger">REVOKED</span>`;
    } else if (sLower === 'draft') {
        return `<span class="badge" style="background:#f1f5f9; color:#475569;">DRAFT</span>`;
    } else if (sLower === 'entered-in-error') {
        return `<span class="badge badge-danger">IN ERROR</span>`;
    }
    return `<span class="badge badge-success">ACTIVE</span>`;
}

/**
 * Open Change Referral Status Modal
 */
function openChangeStatusModal(referralId) {
    const ref = loadedReferralsCache.find(r => r.id === referralId);
    if (!ref) {
        alert('Referral record not found.');
        return;
    }

    const targetInput = document.getElementById('statusModalTargetRefId');
    const refIdEl = document.getElementById('statusModalRefId');
    const patientNameEl = document.getElementById('statusModalPatientName');
    const selectEl = document.getElementById('statusModalSelect');
    const remarksEl = document.getElementById('statusModalRemarks');
    const modalEl = document.getElementById('changeStatusModal');

    if (targetInput) targetInput.value = ref.id;
    if (refIdEl) refIdEl.textContent = ref.id;
    if (patientNameEl) {
        let pName = ref.patientName;
        const resolvedName = getPatientNameById(ref.patientRef);
        if (resolvedName && !resolvedName.startsWith('Patient ') && resolvedName !== 'N/A') {
            pName = resolvedName;
        } else if (!pName) {
            pName = resolvedName;
        }
        patientNameEl.textContent = pName;
    }
    if (selectEl) selectEl.value = ref.status || 'active';
    if (remarksEl) remarksEl.value = ref.statusRemarks || ref.note || '';

    if (modalEl) modalEl.style.display = 'flex';
}

/**
 * Close Change Referral Status Modal
 */
function closeChangeStatusModal() {
    const modalEl = document.getElementById('changeStatusModal');
    if (modalEl) modalEl.style.display = 'none';
}

/**
 * Confirm and Save Referral Status Change with Remarks
 */
async function confirmReferralStatusChange() {
    const targetInput = document.getElementById('statusModalTargetRefId');
    const selectEl = document.getElementById('statusModalSelect');
    const remarksEl = document.getElementById('statusModalRemarks');

    const referralId = targetInput ? targetInput.value : '';
    const newStatus = selectEl ? selectEl.value : 'active';
    const remarks = remarksEl ? remarksEl.value.trim() : '';

    if (!referralId) {
        alert('No referral target selected.');
        return;
    }

    await updateReferralStatus(referralId, newStatus, remarks);
    closeChangeStatusModal();
}

/**
 * Update Referral Status & Remarks in memory and push update to FHIR Server
 */
async function updateReferralStatus(referralId, newStatus, remarks = '') {
    if (!referralId || !newStatus) return;

    const ref = loadedReferralsCache.find(r => r.id === referralId);
    const oldStatus = ref ? (ref.status || 'active') : 'active';

    if (ref) {
        ref.status = newStatus;
        if (remarks) {
            ref.statusRemarks = remarks;
            ref.note = remarks;
        }
        ref.lastUpdated = new Date().toISOString();
    }

    const serverUrl = getFhirServerUrl();
    try {
        const bodyObj = {
            resourceType: 'ServiceRequest',
            id: referralId,
            status: newStatus,
            intent: 'order',
            subject: { reference: ref ? ref.patientRef : 'Patient/1001' }
        };
        if (remarks || (ref && ref.statusRemarks)) {
            bodyObj.note = [{ text: remarks || ref.statusRemarks }];
        }
        await fetchWithTimeout(`${serverUrl}/ServiceRequest/${referralId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/fhir+json' },
            body: JSON.stringify(bodyObj),
            timeout: 5000
        });
    } catch (err) {
        console.warn('FHIR server status update notice:', err.message);
    }

    applyReferralFilters();

    const modalEl = document.getElementById('referralDetailsModal');
    if (modalEl && modalEl.style.display !== 'none' && currentSelectedModalRef && currentSelectedModalRef.id === referralId) {
        openReferralDetailsModal(referralId);
    }

    alert(`✅ Referral (${referralId}) status updated from "${oldStatus.toUpperCase()}" to "${newStatus.toUpperCase()}"${remarks ? ' with remarks' : ''}!`);
}

function updateReferralStatusFromModal(referralId) {
    openChangeStatusModal(referralId);
}
function getPatientNameById(patientId) {
    if (!patientId) return 'N/A';
    let cleanId = String(patientId).trim();
    if (cleanId.includes('/')) {
        const parts = cleanId.split('/');
        cleanId = parts[parts.length - 1];
    }
    const foundLoaded = loadedPatientsCache.find(p => String(p.id).trim() === cleanId);
    if (foundLoaded && foundLoaded.name) return foundLoaded.name;
    const foundFallback = FALLBACK_PATIENTS.find(p => String(p.id).trim() === cleanId);
    if (foundFallback && foundFallback.name) return foundFallback.name;
    return `Patient ${cleanId}`;
}

/**
 * Helper to format ISO timestamp for Referral Table display
 */
function formatReferralTimestamp(isoStr) {
    if (!isoStr) return '<span style="color:var(--muted-text); font-size:0.8rem;">N/A</span>';
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        
        const datePart = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
        const timePart = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        
        return `<div style="font-weight:600; font-size:0.84rem; color:#0f172a; white-space:nowrap;">📅 ${datePart}</div><div style="font-size:0.76rem; color:var(--muted-text); white-space:nowrap;">⏰ ${timePart}</div>`;
    } catch (e) {
        return isoStr;
    }
}

/**
 * Generic FHIR Pagination Fetcher
 */
async function fetchAllFhirResources(resourceType, serverUrl, statusEl, maxCount = 200) {
    let allEntries = [];
    const separator = resourceType.includes('?') ? '&' : '?';
    const pageCount = Math.min(maxCount, 100);
    let nextUrl = `${serverUrl}/${resourceType}${separator}_count=${pageCount}`;
    let page = 1;

    while (nextUrl && allEntries.length < maxCount) {
        if (statusEl) {
            statusEl.textContent = `Fetching ${resourceType}s (Page ${page}, ${allEntries.length} loaded)...`;
        }

        try {
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
            allEntries = allEntries.concat(entries);

            if (allEntries.length >= maxCount) {
                allEntries = allEntries.slice(0, maxCount);
                break;
            }

            const nextLink = (data.link || []).find(l => l.relation === 'next');
            nextUrl = nextLink ? nextLink.url : null;
            page++;
        } catch (err) {
            console.warn(`Fetch step error for ${resourceType} on page ${page}:`, err.message);
            if (allEntries.length > 0) break;
            throw err;
        }
    }

    return allEntries;
}

/* ==========================================================================
   DROPDOWN FETCHING FUNCTIONS (PATIENT, ORG, PRACTITIONER ROLE)
   ========================================================================== */

/**
 * Fetch ALL Patients from FHIR Server
 */
async function fetchPatients() {
    const patientSelect = document.getElementById('patientSelect');
    const statusEl = document.getElementById('patientFetchStatus');
    const serverUrl = getFhirServerUrl();

    if (!patientSelect) return;

    try {
        if (statusEl) statusEl.textContent = `Fetching Patients from ${serverUrl}...`;
        patientSelect.innerHTML = '<option value="">Loading Patients...</option>';

        const entries = await fetchAllFhirResources('Patient', serverUrl, statusEl);

        patientSelect.innerHTML = '<option value="">-- Select Patient --</option>';

        if (entries.length === 0) {
            loadFallbackPatients('No patients found on server. Loaded sample list.');
            return;
        }

        loadedPatientsCache = [];
        entries.forEach(entry => {
            const r = entry.resource;
            if (r && r.id) {
                let name = `Patient ${r.id}`;
                if (r.name && r.name[0]) {
                    const given = (r.name[0].given || []).join(' ');
                    const family = r.name[0].family || '';
                    name = `${family}, ${given}`.trim().replace(/^,|,$/g, '') || name;
                }
                loadedPatientsCache.push({ id: r.id, name, gender: r.gender || '', birthDate: r.birthDate || '' });

                const opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = `${name} (ID: ${r.id})`;
                patientSelect.appendChild(opt);
            }
        });

        if (statusEl) statusEl.textContent = `✅ Loaded ${loadedPatientsCache.length} Patient(s).`;
        initSelect2('patientSelect', '-- Select Patient --');
        if (loadedReferralsCache && loadedReferralsCache.length > 0) {
            applyReferralFilters();
        }
    } catch (err) {
        console.warn('Patient fetch timed out/failed. Using fallback:', err.message);
        loadFallbackPatients('⚠️ Server connection timed out. Loaded sample patients.');
    }
}

function loadFallbackPatients(message) {
    const patientSelect = document.getElementById('patientSelect');
    const statusEl = document.getElementById('patientFetchStatus');
    if (!patientSelect) return;

    patientSelect.innerHTML = '<option value="">-- Select Patient --</option>';
    loadedPatientsCache = FALLBACK_PATIENTS;
    FALLBACK_PATIENTS.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (ID: ${p.id})`;
        patientSelect.appendChild(opt);
    });

    if (statusEl && message) statusEl.textContent = message;
    initSelect2('patientSelect', '-- Select Patient --');
    if (loadedReferralsCache && loadedReferralsCache.length > 0) {
        applyReferralFilters();
    }
}

/**
 * Fetch ALL Organizations from FHIR Server
 */
async function fetchOrganizations() {
    const sendingOrgSelect = document.getElementById('sendingOrgSelect');
    const receivingOrgSelect = document.getElementById('receivingOrgSelect');
    const statusEl = document.getElementById('orgFetchStatus');
    const serverUrl = getFhirServerUrl();

    if (!sendingOrgSelect || !receivingOrgSelect) return;

    try {
        if (statusEl) statusEl.textContent = `Fetching Organizations from ${serverUrl}...`;
        sendingOrgSelect.innerHTML = '<option value="">Loading Organizations...</option>';
        receivingOrgSelect.innerHTML = '<option value="">Loading Organizations...</option>';

        const entries = await fetchAllFhirResources('Organization', serverUrl, statusEl);

        sendingOrgSelect.innerHTML = '<option value="">-- Select Sending Facility --</option>';
        receivingOrgSelect.innerHTML = '<option value="">-- Select Receiving Facility --</option>';

        if (entries.length === 0) {
            loadFallbackOrganizations('No organizations found on server. Loaded sample list.');
            return;
        }

        loadedOrganizationsCache = [];
        entries.forEach(entry => {
            const r = entry.resource;
            if (r && r.id) {
                const orgName = r.name || `Organization ${r.id}`;
                loadedOrganizationsCache.push({ id: r.id, name: orgName });

                const opt1 = document.createElement('option');
                opt1.value = r.id;
                opt1.textContent = `${orgName} (ID: ${r.id})`;
                sendingOrgSelect.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = r.id;
                opt2.textContent = `${orgName} (ID: ${r.id})`;
                receivingOrgSelect.appendChild(opt2);
            }
        });

        if (statusEl) statusEl.textContent = `✅ Loaded ${loadedOrganizationsCache.length} Organization(s).`;
        initSelect2('sendingOrgSelect', '-- Select Sending Facility --');
        initSelect2('receivingOrgSelect', '-- Select Receiving Facility --');
        populateOrganizationFilterDropdown(loadedOrganizationsCache);
    } catch (err) {
        console.warn('Organization fetch timed out/failed. Using fallback:', err.message);
        loadFallbackOrganizations('⚠️ Server connection timed out. Loaded sample organizations.');
    }
}

function loadFallbackOrganizations(message) {
    const sendingOrgSelect = document.getElementById('sendingOrgSelect');
    const receivingOrgSelect = document.getElementById('receivingOrgSelect');
    const statusEl = document.getElementById('orgFetchStatus');
    if (!sendingOrgSelect || !receivingOrgSelect) return;

    sendingOrgSelect.innerHTML = '<option value="">-- Select Sending Facility --</option>';
    receivingOrgSelect.innerHTML = '<option value="">-- Select Receiving Facility --</option>';
    loadedOrganizationsCache = FALLBACK_ORGANIZATIONS;

    FALLBACK_ORGANIZATIONS.forEach(org => {
        const opt1 = document.createElement('option');
        opt1.value = org.id;
        opt1.textContent = `${org.name} (ID: ${org.id})`;
        sendingOrgSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = org.id;
        opt2.textContent = `${org.name} (ID: ${org.id})`;
        receivingOrgSelect.appendChild(opt2);
    });

    if (statusEl && message) statusEl.textContent = message;
    initSelect2('sendingOrgSelect', '-- Select Sending Facility --');
    initSelect2('receivingOrgSelect', '-- Select Receiving Facility --');
    populateOrganizationFilterDropdown(FALLBACK_ORGANIZATIONS);
}

/**
 * Update Sending PractitionerRole Options based on selected Sending Organization
 */
function onSendingOrgChange() {
    const sendingOrgSelect = document.getElementById('sendingOrgSelect');
    const selectedOrgId = sendingOrgSelect ? sendingOrgSelect.value : '';
    updateSendingRoleOptions(selectedOrgId);
    updateJsonPreview();
}

/**
 * Update Receiving PractitionerRole Options based on selected Receiving Organization
 */
function onReceivingOrgChange() {
    const receivingOrgSelect = document.getElementById('receivingOrgSelect');
    const selectedOrgId = receivingOrgSelect ? receivingOrgSelect.value : '';
    updateReceivingRoleOptions(selectedOrgId);
    updateJsonPreview();
}

function updateSendingRoleOptions(orgId) {
    const roleSelect = document.getElementById('sendingRoleSelect');
    if (!roleSelect) return;

    roleSelect.innerHTML = '';
    const cleanOrgId = orgId ? String(orgId).replace(/^Organization\//i, '').trim().toLowerCase() : '';

    if (!cleanOrgId) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Select Sending Facility First --';
        defaultOpt.selected = true;
        roleSelect.appendChild(defaultOpt);
        roleSelect.value = '';
        initSelect2('sendingRoleSelect', '-- Select Sending Facility First --');
        return;
    }

    const filteredRoles = loadedPractitionerRolesCache.filter(r => {
        if (!r.orgRef) return false;
        const cleanRef = String(r.orgRef).replace(/^Organization\//i, '').trim().toLowerCase();
        return cleanRef === cleanOrgId;
    });

    if (filteredRoles.length === 0) {
        const noOpt = document.createElement('option');
        noOpt.value = '';
        noOpt.textContent = '-- No PractitionerRoles found for this Facility --';
        noOpt.selected = true;
        roleSelect.appendChild(noOpt);
        roleSelect.value = '';
    } else {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = `-- Select PractitionerRole (${filteredRoles.length} available) --`;
        roleSelect.appendChild(defaultOpt);

        filteredRoles.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            const orgName = r.orgRef ? getOrgNameById(r.orgRef) : '';
            opt.textContent = `${r.display}${orgName ? ' [' + orgName + ']' : ''}`;
            roleSelect.appendChild(opt);
        });
    }

    initSelect2('sendingRoleSelect', '-- Select PractitionerRole --');
}

function updateReceivingRoleOptions(orgId) {
    const roleSelect = document.getElementById('receivingRoleSelect');
    if (!roleSelect) return;

    roleSelect.innerHTML = '';
    const cleanOrgId = orgId ? String(orgId).replace(/^Organization\//i, '').trim().toLowerCase() : '';

    if (!cleanOrgId) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Select Receiving Facility First --';
        defaultOpt.selected = true;
        roleSelect.appendChild(defaultOpt);
        roleSelect.value = '';
        initSelect2('receivingRoleSelect', '-- Select Receiving Facility First --');
        return;
    }

    const filteredRoles = loadedPractitionerRolesCache.filter(r => {
        if (!r.orgRef) return false;
        const cleanRef = String(r.orgRef).replace(/^Organization\//i, '').trim().toLowerCase();
        return cleanRef === cleanOrgId;
    });

    if (filteredRoles.length === 0) {
        const noOpt = document.createElement('option');
        noOpt.value = '';
        noOpt.textContent = '-- No Receiving PractitionerRoles found for this Facility --';
        noOpt.selected = true;
        roleSelect.appendChild(noOpt);
        roleSelect.value = '';
    } else {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = `-- Select Receiving PractitionerRole (${filteredRoles.length} available) --`;
        roleSelect.appendChild(defaultOpt);

        filteredRoles.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            const orgName = r.orgRef ? getOrgNameById(r.orgRef) : '';
            opt.textContent = `${r.display}${orgName ? ' [' + orgName + ']' : ''}`;
            roleSelect.appendChild(opt);
        });
    }

    initSelect2('receivingRoleSelect', '-- Select Receiving PractitionerRole --');
}

/**
 * Fetch ALL PractitionerRoles from FHIR Server
 */
async function fetchPractitionerRoles() {
    const roleSelect = document.getElementById('sendingRoleSelect');
    const statusEl = document.getElementById('roleFetchStatus');
    const serverUrl = getFhirServerUrl();

    if (!roleSelect) return;

    try {
        if (statusEl) statusEl.textContent = `Fetching PractitionerRoles from ${serverUrl}...`;

        const entries = await fetchAllFhirResources('PractitionerRole', serverUrl, statusEl);

        if (entries.length === 0) {
            loadFallbackPractitionerRoles('No PractitionerRoles found on server. Loaded sample list.');
            return;
        }

        loadedPractitionerRolesCache = [];
        entries.forEach(entry => {
            const r = entry.resource;
            if (r && r.id) {
                const pracRef = r.practitioner ? r.practitioner.reference : '';
                const orgRef = r.organization ? r.organization.reference : '';
                const coding = (r.code && r.code[0] && r.code[0].coding && r.code[0].coding[0]) ? r.code[0].coding[0] : {};
                const roleDisplay = coding.display || 'PractitionerRole';

                const displayStr = `${roleDisplay} (Role ID: ${r.id}${orgRef ? ' | ' + getOrgNameById(orgRef) : ''})`;
                loadedPractitionerRolesCache.push({ id: r.id, display: displayStr, orgRef, pracRef });
            }
        });

        if (statusEl) statusEl.textContent = `✅ Loaded ${loadedPractitionerRolesCache.length} PractitionerRole(s).`;
        const sendingOrgVal = document.getElementById('sendingOrgSelect')?.value || '';
        const receivingOrgVal = document.getElementById('receivingOrgSelect')?.value || '';
        updateSendingRoleOptions(sendingOrgVal);
        updateReceivingRoleOptions(receivingOrgVal);
        reResolveReferralRoleOrganizations();
    } catch (err) {
        console.warn('PractitionerRole fetch timed out/failed. Using fallback:', err.message);
        loadFallbackPractitionerRoles('⚠️ Server connection timed out. Loaded sample PractitionerRoles.');
    }
}

function loadFallbackPractitionerRoles(message) {
    const statusEl = document.getElementById('roleFetchStatus');
    loadedPractitionerRolesCache = FALLBACK_PRACTITIONER_ROLES;

    if (statusEl && message) statusEl.textContent = message;
    const sendingOrgVal = document.getElementById('sendingOrgSelect')?.value || '';
    const receivingOrgVal = document.getElementById('receivingOrgSelect')?.value || '';
    updateSendingRoleOptions(sendingOrgVal);
    updateReceivingRoleOptions(receivingOrgVal);
}

/* ==========================================================================
   ICD-10 & VITAL SIGNS BUNDLE GENERATION & BULK SAVING
   ========================================================================== */

/**
 * Handle ICD-10 Dropdown Selection Change
 */
function handleIcdSelectChange() {
    const icdSelect = document.getElementById('icdSelect');
    const customContainer = document.getElementById('customIcdContainer');
    const icdCodeInput = document.getElementById('icdCode');
    const icdDisplayInput = document.getElementById('icdDisplay');

    if (!icdSelect) return;

    if (icdSelect.value === 'custom') {
        if (customContainer) customContainer.style.display = 'grid';
    } else {
        if (customContainer) customContainer.style.display = 'none';
        const selectedOpt = icdSelect.options[icdSelect.selectedIndex];
        if (selectedOpt) {
            const code = selectedOpt.value;
            const display = selectedOpt.getAttribute('data-display') || selectedOpt.textContent;
            if (icdCodeInput) icdCodeInput.value = code;
            if (icdDisplayInput) icdDisplayInput.value = display;
        }
    }
    updateJsonPreview();
}

/**
 * Build FHIR e-Referral Transaction Bundle JSON
 */
function buildEreferralBundleJSON() {
    const patientSelect = document.getElementById('patientSelect');
    const sendingOrgSelect = document.getElementById('sendingOrgSelect');
    const sendingRoleSelect = document.getElementById('sendingRoleSelect');
    const receivingOrgSelect = document.getElementById('receivingOrgSelect');
    const receivingRoleSelect = document.getElementById('receivingRoleSelect');
    const chiefComplaintInput = document.getElementById('chiefComplaint');

    const prioritySelect = document.getElementById('referralPriority');
    const noteInput = document.getElementById('referralNote');

    const icdSelect = document.getElementById('icdSelect');
    const icdCodeInput = document.getElementById('icdCode');
    const icdDisplayInput = document.getElementById('icdDisplay');

    // Vital Signs Inputs
    const tempInput = document.getElementById('vitalTemp');
    const hrInput = document.getElementById('vitalHr');
    const rrInput = document.getElementById('vitalRr');
    const bpSysInput = document.getElementById('vitalBpSys');
    const bpDiaInput = document.getElementById('vitalBpDia');
    const spo2Input = document.getElementById('vitalSpo2');

    const patientId = patientSelect ? patientSelect.value : '';
    const sendingOrgId = sendingOrgSelect ? sendingOrgSelect.value : '';
    const sendingRoleId = sendingRoleSelect ? sendingRoleSelect.value : '';
    const receivingOrgId = receivingOrgSelect ? receivingOrgSelect.value : '';
    const receivingRoleId = receivingRoleSelect ? receivingRoleSelect.value : '';
    const chiefComplaintText = chiefComplaintInput ? chiefComplaintInput.value.trim() : '';

    const priority = prioritySelect ? prioritySelect.value : 'routine';
    const noteText = noteInput ? noteInput.value.trim() : '';

    const categorySelect = document.getElementById('categorySelect');
    let categoryCode = '440655000';
    let categoryDisplay = 'Outpatient environment';
    if (categorySelect && categorySelect.selectedIndex >= 0) {
        const opt = categorySelect.options[categorySelect.selectedIndex];
        if (opt) {
            categoryCode = opt.value || '440655000';
            categoryDisplay = opt.getAttribute('data-display') || opt.textContent;
        }
    }

    const disabilitySelect = document.getElementById('disabilitySelect');
    const disabilityNotesInput = document.getElementById('disabilityNotes');
    const disabilityType = disabilitySelect ? disabilitySelect.value : 'none';
    const disabilityNotes = disabilityNotesInput ? disabilityNotesInput.value.trim() : '';

    let disabilityCode = 'none';
    let disabilityDisplay = 'None / Non-PWD';
    if (disabilitySelect && disabilitySelect.selectedIndex >= 0) {
        const opt = disabilitySelect.options[disabilitySelect.selectedIndex];
        if (opt) {
            disabilityCode = opt.getAttribute('data-code') || opt.value;
            disabilityDisplay = opt.getAttribute('data-display') || opt.textContent;
        }
    }

    let icdCode = 'I10';
    let icdDisplay = 'Essential (primary) hypertension';

    if (icdSelect && icdSelect.value !== 'custom' && icdSelect.selectedIndex >= 0) {
        const opt = icdSelect.options[icdSelect.selectedIndex];
        if (opt && opt.value) {
            icdCode = opt.value;
            icdDisplay = opt.getAttribute('data-display') || opt.textContent;
        }
    } else {
        if (icdCodeInput && icdCodeInput.value.trim()) icdCode = icdCodeInput.value.trim();
        if (icdDisplayInput && icdDisplayInput.value.trim()) icdDisplay = icdDisplayInput.value.trim();
    }

    const bundleEntries = [];

    // Performers list (Receiving Facility Organization/Id & Receiving PractitionerRole/Id)
    const performers = [];
    if (receivingOrgId) {
        performers.push({ "reference": `Organization/${receivingOrgId}` });
    }
    if (receivingRoleId) {
        performers.push({ "reference": `PractitionerRole/${receivingRoleId}` });
    }
    if (performers.length === 0) {
        performers.push({ "reference": "Organization/SLMC-ORG-002" });
    }

    // Requester reference (Sending PractitionerRole or Sending Organization)
    let requesterRef = "Organization/PGH-ORG-001";
    if (sendingRoleId) {
        requesterRef = `PractitionerRole/${sendingRoleId}`;
    } else if (sendingOrgId) {
        requesterRef = `Organization/${sendingOrgId}`;
    }

    // Reason codes list (SNOMED CT Service Type & ICD-10 Diagnosis narrative)
    const reasonCodes = [
        {
            "text": chiefComplaintText ? `${chiefComplaintText} (ICD-10: ${icdCode} - ${icdDisplay})` : `ICD-10: ${icdCode} - ${icdDisplay}`,
            "coding": [
                {
                    "system": "http://snomed.info/sct",
                    "code": "11429006",
                    "display": "Consultation"
                }
            ]
        }
    ];

    const nowIso = new Date().toISOString();
    const reqRefId = `REF-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const patientRefStr = patientId ? `Patient/${patientId}` : "Patient/1001";

    const encounterClassSelect = document.getElementById('encounterClassSelect');
    const encounterStatusSelect = document.getElementById('encounterStatusSelect');
    let encClassCode = 'AMB';
    let encClassDisplay = 'ambulatory';
    if (encounterClassSelect && encounterClassSelect.selectedIndex >= 0) {
        const opt = encounterClassSelect.options[encounterClassSelect.selectedIndex];
        if (opt) {
            encClassCode = opt.value || 'AMB';
            encClassDisplay = opt.getAttribute('data-display') || opt.textContent;
        }
    }
    const encStatus = encounterStatusSelect ? encounterStatusSelect.value : 'finished';
    const encounterFullUrl = generateUuid();
    const serviceRequestFullUrl = generateUuid();

    // 1. Core ServiceRequest (e-Referral Resource)
    const serviceRequestResource = {
        "resourceType": "ServiceRequest",
        "meta": {
            "profile": [
                "https://www.fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request"
            ]
        },
        "text": {
            "status": "generated",
            "div": `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>e-Referral ServiceRequest</b>: ${reqRefId}</p></div>`
        },
        "requisition": {
            "system": "urn:oid:1.2.840.113619.21.1.2",
            "value": reqRefId
        },
        "status": "active",
        "intent": "order",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": categoryCode,
                        "display": categoryDisplay
                    }
                ],
                "text": categoryDisplay
            }
        ],
        "priority": priority,
        "code": {
            "coding": [
                {
                    "system": "http://snomed.info/sct",
                    "code": "3457005",
                    "display": "Patient referral"
                }
            ]
        },
        "subject": {
          "reference": patientId ? `Patient/${patientId}` : "Patient/1001",
          "display": getPatientNameById(patientId || '1001')
        },
        "encounter": {
          "reference": encounterFullUrl
        },
        "occurrenceDateTime": nowIso,
        "authoredOn": nowIso,
        "requester": {
          "reference": requesterRef
        },
        "performer": performers,
        "reasonCode": reasonCodes
    };

    if (noteText) {
        serviceRequestResource["note"] = [{ "text": noteText }];
    }

    // Add ServiceRequest Entry
    bundleEntries.push({
        "fullUrl": serviceRequestFullUrl,
        "resource": serviceRequestResource,
        "request": {
            "method": "POST",
            "url": "ServiceRequest"
        }
    });

    // Add Encounter Resource Entry
    bundleEntries.push({
        "fullUrl": encounterFullUrl,
        "resource": {
            "resourceType": "Encounter",
            "meta": {
                "profile": [
                    "https://www.fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-encounter"
                ]
            },
            "text": {
                "status": "generated",
                "div": `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Clinical Encounter</b>: ${encClassDisplay}</p></div>`
            },
            "status": encStatus,
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": encClassCode,
                "display": encClassDisplay
            },
            "subject": {
                "reference": patientRefStr,
                "display": getPatientNameById(patientId || '1001')
            },
            "period": {
                "start": nowIso
            }
        },
        "request": {
            "method": "POST",
            "url": "Encounter"
        }
    });

    // Observation Performer reference
    const obsPerformer = [];
    if (sendingRoleId) {
        obsPerformer.push({ "reference": `PractitionerRole/${sendingRoleId}` });
    } else if (sendingOrgId) {
        obsPerformer.push({ "reference": `Organization/${sendingOrgId}` });
    } else {
        obsPerformer.push({ "reference": "Organization/PGH-ORG-001" });
    }

    // 2. Observations (Disability Status & Vital Signs)

    // Disability Status Observation (LOINC 8479-3)
    if (disabilityType !== 'none' || disabilityNotes) {
        const disText = `${disabilityDisplay}${disabilityNotes ? ' - Accommodations: ' + disabilityNotes : ''}`;
        bundleEntries.push({
            "fullUrl": generateUuid(),
            "resource": {
                "resourceType": "Observation",
                "text": {
                    "status": "generated",
                    "div": `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Disability Status Observation</b>: ${disText}</p></div>`
                },
                "status": "final",
                "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "exam", "display": "Exam" }] }],
                "code": { "coding": [{ "system": "http://loinc.org", "code": "8479-3", "display": "Disability status" }] },
                "subject": { "reference": patientRefStr },
                "effectiveDateTime": nowIso,
                "performer": obsPerformer,
                "valueCodeableConcept": {
                    "coding": (disabilityCode && disabilityCode !== 'none') ? [{ "system": "http://snomed.info/sct", "code": disabilityCode, "display": disabilityDisplay }] : [],
                    "text": disText
                }
            },
            "request": { "method": "POST", "url": "Observation" }
        });
    }

    // Temperature (°C) LOINC 8310-5
    if (tempInput && tempInput.value) {
        const val = parseFloat(tempInput.value);
        if (!isNaN(val)) {
            bundleEntries.push({
                "fullUrl": generateUuid(),
                "resource": {
                    "resourceType": "Observation",
                    "text": {
                        "status": "generated",
                        "div": `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Body Temperature Observation</b>: ${val} °C</p></div>`
                    },
                    "status": "final",
                    "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs", "display": "Vital Signs" }] }],
                    "code": { "coding": [{ "system": "http://loinc.org", "code": "8310-5", "display": "Body temperature" }] },
                    "subject": { "reference": patientRefStr },
                    "effectiveDateTime": nowIso,
                    "performer": obsPerformer,
                    "valueQuantity": { "value": val, "unit": "C", "system": "http://unitsofmeasure.org", "code": "Cel" }
                },
                "request": { "method": "POST", "url": "Observation" }
            });
        }
    }

    // Heart Rate (bpm) LOINC 8867-4
    if (hrInput && hrInput.value) {
        const val = parseFloat(hrInput.value);
        if (!isNaN(val)) {
            bundleEntries.push({
                "fullUrl": generateUuid(),
                "resource": {
                    "resourceType": "Observation",
                    "text": {
                        "status": "generated",
                        "div": `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Heart Rate Observation</b>: ${val} /min</p></div>`
                    },
                    "status": "final",
                    "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs", "display": "Vital Signs" }] }],
                    "code": { "coding": [{ "system": "http://loinc.org", "code": "8867-4", "display": "Heart rate" }] },
                    "subject": { "reference": patientRefStr },
                    "effectiveDateTime": nowIso,
                    "performer": obsPerformer,
                    "valueQuantity": { "value": val, "unit": "/min", "system": "http://unitsofmeasure.org", "code": "/min" }
                },
                "request": { "method": "POST", "url": "Observation" }
            });
        }
    }

    // Respiratory Rate (bpm) LOINC 9279-1
    if (rrInput && rrInput.value) {
        const val = parseFloat(rrInput.value);
        if (!isNaN(val)) {
            bundleEntries.push({
                "fullUrl": generateUuid(),
                "resource": {
                    "resourceType": "Observation",
                    "text": {
                        "status": "generated",
                        "div": `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Respiratory Rate Observation</b>: ${val} /min</p></div>`
                    },
                    "status": "final",
                    "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs", "display": "Vital Signs" }] }],
                    "code": { "coding": [{ "system": "http://loinc.org", "code": "9279-1", "display": "Respiratory rate" }] },
                    "subject": { "reference": patientRefStr },
                    "effectiveDateTime": nowIso,
                    "performer": obsPerformer,
                    "valueQuantity": { "value": val, "unit": "/min", "system": "http://unitsofmeasure.org", "code": "/min" }
                },
                "request": { "method": "POST", "url": "Observation" }
            });
        }
    }

    // Blood Pressure LOINC 85354-9 (Systolic / Diastolic)
    const sysVal = bpSysInput ? parseFloat(bpSysInput.value) : NaN;
    const diaVal = bpDiaInput ? parseFloat(bpDiaInput.value) : NaN;
    if (!isNaN(sysVal) || !isNaN(diaVal)) {
        const components = [];
        if (!isNaN(sysVal)) {
            components.push({
                "code": { "coding": [{ "system": "http://loinc.org", "code": "8480-6", "display": "Systolic blood pressure" }] },
                "valueQuantity": { "value": sysVal, "unit": "mmHg", "system": "http://unitsofmeasure.org", "code": "mm[Hg]" }
            });
        }
        if (!isNaN(diaVal)) {
            components.push({
                "code": { "coding": [{ "system": "http://loinc.org", "code": "8462-4", "display": "Diastolic blood pressure" }] },
                "valueQuantity": { "value": diaVal, "unit": "mmHg", "system": "http://unitsofmeasure.org", "code": "mm[Hg]" }
            });
        }
        bundleEntries.push({
            "fullUrl": generateUuid(),
            "resource": {
                "resourceType": "Observation",
                "text": {
                    "status": "generated",
                    "div": `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Blood Pressure Observation</b>: ${!isNaN(sysVal) ? sysVal : ''}/${!isNaN(diaVal) ? diaVal : ''} mmHg</p></div>`
                },
                "status": "final",
                "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs", "display": "Vital Signs" }] }],
                "code": { "coding": [{ "system": "http://loinc.org", "code": "85354-9", "display": "Blood pressure panel with all children optional" }] },
                "subject": { "reference": patientRefStr },
                "effectiveDateTime": nowIso,
                "performer": obsPerformer,
                "component": components
            },
            "request": { "method": "POST", "url": "Observation" }
        });
    }

    // Oxygen Saturation (%) LOINC 59408-5
    if (spo2Input && spo2Input.value) {
        const val = parseFloat(spo2Input.value);
        if (!isNaN(val)) {
            bundleEntries.push({
                "fullUrl": generateUuid(),
                "resource": {
                    "resourceType": "Observation",
                    "text": {
                        "status": "generated",
                        "div": `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Oxygen Saturation Observation</b>: ${val} %</p></div>`
                    },
                    "status": "final",
                    "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "vital-signs", "display": "Vital Signs" }] }],
                    "code": { "coding": [{ "system": "http://loinc.org", "code": "59408-5", "display": "Oxygen saturation in Arterial blood by Pulse oximetry" }] },
                    "subject": { "reference": patientRefStr },
                    "effectiveDateTime": nowIso,
                    "performer": obsPerformer,
                    "valueQuantity": { "value": val, "unit": "%", "system": "http://unitsofmeasure.org", "code": "%" }
                },
                "request": { "method": "POST", "url": "Observation" }
            });
        }
    }

    return {
        "resourceType": "Bundle",
        "type": "transaction",
        "entry": bundleEntries
    };
}

/**
 * Reset Referral Form
 */
function resetEreferralForm() {
    const form = document.getElementById('ereferralForm');
    if (form) form.reset();

    if (window.jQuery) {
        $('#patientSelect').val('').trigger('change');
        $('#sendingOrgSelect').val('').trigger('change');
        $('#sendingRoleSelect').val('').trigger('change');
        $('#receivingOrgSelect').val('').trigger('change');
        $('#receivingRoleSelect').val('').trigger('change');
        $('#categorySelect').val('386053000').trigger('change');
        $('#icdSelect').val('I10').trigger('change');
    }
    updateJsonPreview();
}

/**
 * Update JSON Live Preview
 */
function updateJsonPreview() {
    const previewEl = document.getElementById('jsonPreview');
    if (!previewEl) return;
    const bundleObj = buildEreferralBundleJSON();
    previewEl.textContent = JSON.stringify(bundleObj, null, 2);
}

/**
 * Handle form submission: Bulk Save e-Referral (FHIR Transaction Bundle)
 */
async function submitEreferralBundle(event) {
    if (event) event.preventDefault();
    const resultEl = document.getElementById('submissionResult');
    const serverUrl = getFhirServerUrl();
    const bundleData = buildEreferralBundleJSON();

    try {
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.className = 'info-message';
            resultEl.textContent = `Bulk Submitting e-Referral Transaction Bundle (${bundleData.entry.length} resources) to ${serverUrl}...`;
        }

        let responseData = null;
        let createdId = `REF-2026-${Math.floor(100 + Math.random() * 900)}`;
        let submitSuccess = false;
        let serverErrorDiag = '';

        try {
            const response = await fetchWithTimeout(serverUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/fhir+json',
                    'Accept': 'application/fhir+json, application/json'
                },
                body: JSON.stringify(bundleData),
                timeout: 10000
            });

            try {
                responseData = await response.json();
            } catch (e) {}

            const locationHeader = response.headers.get('Location') || response.headers.get('location');
            if (locationHeader) {
                const parts = locationHeader.split('/');
                const srIndex = parts.indexOf('ServiceRequest');
                if (srIndex !== -1 && parts[srIndex + 1]) {
                    createdId = parts[srIndex + 1];
                }
            } else if (responseData && responseData.entry) {
                const srEntry = responseData.entry.find(e => e.response && e.response.location && e.response.location.includes('ServiceRequest'));
                if (srEntry && srEntry.response.location) {
                    const parts = srEntry.response.location.split('/');
                    if (parts[1]) createdId = parts[1];
                }
            }

            if (response.ok) {
                submitSuccess = true;
            } else {
                if (responseData && responseData.issue && Array.isArray(responseData.issue)) {
                    serverErrorDiag = responseData.issue.map(i => i.diagnostics || i.code).filter(Boolean).join('; ');
                } else if (responseData) {
                    serverErrorDiag = JSON.stringify(responseData);
                } else {
                    serverErrorDiag = `HTTP ${response.status} ${response.statusText}`;
                }
            }
        } catch (fetchErr) {
            console.warn('Network bulk submission notice:', fetchErr.message);
            serverErrorDiag = fetchErr.message;
        }

        // Extract values for table prepend
        const srEntry = bundleData.entry.find(e => e.resource && e.resource.resourceType === 'ServiceRequest');
        const srResource = srEntry ? srEntry.resource : {};
        const pRef = srResource.subject ? srResource.subject.reference : '';
        const patientSelect = document.getElementById('patientSelect');
        let pName = '';
        if (patientSelect && patientSelect.selectedIndex >= 0) {
            const opt = patientSelect.options[patientSelect.selectedIndex];
            if (opt && opt.value) {
                pName = opt.textContent.replace(/\s*\(ID:.*?\)/, '').trim();
            }
        }
        if (!pName || pName.startsWith('Patient ')) {
            const resolvedName = getPatientNameById(pRef);
            if (resolvedName && !resolvedName.startsWith('Patient ')) pName = resolvedName;
        }
        if (!pName) pName = getPatientNameById(pRef);

        const sendingOrgSelect = document.getElementById('sendingOrgSelect');
        const sendingRoleSelect = document.getElementById('sendingRoleSelect');
        const receivingOrgSelect = document.getElementById('receivingOrgSelect');
        const receivingRoleSelect = document.getElementById('receivingRoleSelect');
        const chiefComplaintInput = document.getElementById('chiefComplaint');
        const disabilitySelect = document.getElementById('disabilitySelect');
        const disabilityNotesInput = document.getElementById('disabilityNotes');

        const sendOrgVal = sendingOrgSelect ? sendingOrgSelect.value : '';
        const sendOrgRef = sendOrgVal ? `Organization/${sendOrgVal}` : (srResource.requester ? srResource.requester.reference : 'Organization/PGH-ORG-001');
        const sendRoleRef = sendingRoleSelect && sendingRoleSelect.value ? `PractitionerRole/${sendingRoleSelect.value}` : '';

        const recvOrgVal = receivingOrgSelect ? receivingOrgSelect.value : '';
        const recvOrgRef = recvOrgVal ? `Organization/${recvOrgVal}` : 'Organization/SLMC-ORG-002';
        const recvRoleRef = receivingRoleSelect && receivingRoleSelect.value ? `PractitionerRole/${receivingRoleSelect.value}` : '';
        const chiefComplaintText = chiefComplaintInput ? chiefComplaintInput.value.trim() : '';

        const disType = disabilitySelect ? disabilitySelect.value : 'none';
        const disNotes = disabilityNotesInput ? disabilityNotesInput.value.trim() : '';
        let disDisp = '';
        if (disabilitySelect && disabilitySelect.selectedIndex >= 0 && disType !== 'none') {
            const opt = disabilitySelect.options[disabilitySelect.selectedIndex];
            if (opt) disDisp = opt.getAttribute('data-display') || opt.textContent;
        }
        const disabilityText = disType !== 'none' ? `${disDisp}${disNotes ? ' (' + disNotes + ')' : ''}` : (disNotes ? disNotes : '');

        let icdCode = 'I10';
        let icdDisplay = 'Essential hypertension';
        if (srResource.reasonCode) {
            const icdRc = srResource.reasonCode.find(rc => rc.coding && rc.coding.some(c => c.system && c.system.includes('icd-10')));
            if (icdRc && icdRc.coding[0]) {
                icdCode = icdRc.coding[0].code || 'I10';
                icdDisplay = icdRc.coding[0].display || 'Essential hypertension';
            }
        }

        const encClassSelect = document.getElementById('encounterClassSelect');
        const encStatusSelect = document.getElementById('encounterStatusSelect');
        const encClassVal = encClassSelect ? encClassSelect.value : 'AMB';
        const encStatusVal = encStatusSelect ? encStatusSelect.value : 'finished';

        const encRef = (srResource.encounter && srResource.encounter.reference) ? srResource.encounter.reference : 'urn:uuid:encounter';

        const createdReferralRecord = {
            id: createdId,
            patientRef: pRef,
            patientName: pName,
            encounterRef: encRef,
            encounterClass: encClassVal,
            encounterStatus: encStatusVal,
            sendingOrgRef: sendOrgRef,
            sendingRoleRef: sendRoleRef ? `PractitionerRole/${sendRoleRef}` : sendOrgRef,
            receivingOrgRef: recvOrgRef,
            receivingRoleRef: recvRoleRef ? `PractitionerRole/${recvRoleRef}` : '',
            chiefComplaint: chiefComplaintText,
            disability: disabilityText,
            icdCode: icdCode,
            icdDisplay: icdDisplay,
            priority: srResource.priority || 'routine',
            status: srResource.status || 'active',
            note: (srResource.note && srResource.note[0]) ? srResource.note[0].text : '',
            lastUpdated: new Date().toISOString()
        };

        loadedReferralsCache = [createdReferralRecord, ...loadedReferralsCache];
        sortReferralsDescending(loadedReferralsCache);
        applyReferralFilters();

        if (resultEl) {
            if (submitSuccess) {
                resultEl.className = 'success-message';
                resultEl.innerHTML = `<strong>Success!</strong> e-Referral Bulk Saved (${bundleData.entry.length} resources).<br>
                Referral ServiceRequest ID: <code>${createdId}</code><br>
                <span style="font-size:0.85rem;">👇 Scroll down to the <strong>e-Referrals Directory</strong> table to view your newly created referral!</span>
                ${responseData ? `<details><summary>View Server Response</summary><pre>${JSON.stringify(responseData, null, 2)}</pre></details>` : ''}`;
            } else {
                resultEl.className = 'warning-message';
                resultEl.innerHTML = `⚠️ <strong>Server Validation Response:</strong> ${serverErrorDiag || 'HTTP Error'}<br>
                <span style="font-size:0.85rem;">Local referral record created for offline/preview directory display below.</span>
                ${responseData ? `<details><summary>View Server Response Details</summary><pre>${JSON.stringify(responseData, null, 2)}</pre></details>` : ''}`;
            }
        }

        const directoryCard = document.getElementById('referralsDirectoryCard');
        if (directoryCard) {
            setTimeout(() => {
                directoryCard.scrollIntoView({ behavior: 'smooth' });
            }, 500);
        }
    } catch (err) {
        console.error('Submission error:', err);
        if (resultEl) {
            resultEl.className = 'error-message';
            resultEl.textContent = `Error bulk saving e-Referral: ${err.message}`;
        }
    }
}

/* ==========================================================================
   DIRECTORY VIEW, FILTERS & PAGINATION
   ========================================================================== */

/**
 * Helper to resolve Organization reference from a PractitionerRole reference
 */
function getOrgRefFromRoleRef(roleRef) {
    if (!roleRef) return '';
    const cleanRoleId = extractResourceTargetId(roleRef);
    if (!cleanRoleId) return '';
    const foundRole = loadedPractitionerRolesCache.find(r => extractResourceTargetId(r.id) === cleanRoleId);
    if (foundRole && foundRole.orgRef) {
        return foundRole.orgRef;
    }
    return '';
}

/**
 * Re-resolves sendingOrgRef and receivingOrgRef for loaded referrals after PractitionerRoles finish loading or are fetched on-demand
 */
function reResolveReferralRoleOrganizations() {
    if (!loadedReferralsCache || loadedReferralsCache.length === 0) return;
    let updatedCount = 0;
    loadedReferralsCache.forEach(ref => {
        if (ref.receivingRoleRef) {
            const resolvedOrg = getOrgRefFromRoleRef(ref.receivingRoleRef);
            if (resolvedOrg && (!ref.receivingOrgRef || ref.receivingOrgRef === ref.receivingRoleRef)) {
                ref.receivingOrgRef = resolvedOrg;
                updatedCount++;
            }
        }
        if (ref.sendingRoleRef) {
            const resolvedOrg = getOrgRefFromRoleRef(ref.sendingRoleRef);
            if (resolvedOrg && (!ref.sendingOrgRef || ref.sendingOrgRef === ref.sendingRoleRef)) {
                ref.sendingOrgRef = resolvedOrg;
                updatedCount++;
            }
        }
    });
    applyReferralFilters();
}

/**
 * Fetch missing PractitionerRoles referenced by e-Referrals on-demand
 */
async function fetchMissingRoleOrganizations(referrals) {
    if (!referrals || !Array.isArray(referrals)) return;
    const serverUrl = getFhirServerUrl();
    const missingRoleIds = new Set();

    referrals.forEach(ref => {
        if (ref.receivingRoleRef) {
            const roleId = extractResourceTargetId(ref.receivingRoleRef);
            if (roleId && !loadedPractitionerRolesCache.some(r => extractResourceTargetId(r.id) === roleId)) {
                missingRoleIds.add(roleId);
            }
        }
        if (ref.sendingRoleRef) {
            const roleId = extractResourceTargetId(ref.sendingRoleRef);
            if (roleId && !loadedPractitionerRolesCache.some(r => extractResourceTargetId(r.id) === roleId)) {
                missingRoleIds.add(roleId);
            }
        }
    });

    if (missingRoleIds.size === 0) return;

    const fetchPromises = Array.from(missingRoleIds).map(async (roleId) => {
        try {
            const response = await fetchWithTimeout(`${serverUrl}/PractitionerRole/${roleId}`, {
                headers: { 'Accept': 'application/fhir+json, application/json' },
                timeout: FETCH_TIMEOUT_MS
            });
            if (response.ok) {
                const r = await response.json();
                if (r && r.id) {
                    const orgRef = r.organization ? r.organization.reference : '';
                    const pracRef = r.practitioner ? r.practitioner.reference : '';
                    const coding = (r.code && r.code[0] && r.code[0].coding && r.code[0].coding[0]) ? r.code[0].coding[0] : {};
                    const roleDisplay = coding.display || 'PractitionerRole';
                    const displayStr = `${roleDisplay} (Role ID: ${r.id}${orgRef ? ' | ' + getOrgNameById(orgRef) : ''})`;

                    if (!loadedPractitionerRolesCache.some(item => extractResourceTargetId(item.id) === extractResourceTargetId(r.id))) {
                        loadedPractitionerRolesCache.push({ id: r.id, display: displayStr, orgRef, pracRef });
                    }
                }
            }
        } catch (err) {
            console.warn(`Could not fetch missing PractitionerRole ${roleId}:`, err.message);
        }
    });

    await Promise.all(fetchPromises);
    reResolveReferralRoleOrganizations();
}

/**
 * Fetch and Render e-Referrals Directory
 */
async function fetchAndRenderReferrals() {
    const statusEl = document.getElementById('referralsListStatus');
    const serverUrl = getFhirServerUrl();

    try {
        if (statusEl) statusEl.textContent = `Fetching e-Referrals list from ${serverUrl}...`;

        const entries = await fetchAllFhirResources('ServiceRequest?_sort=-_lastUpdated', serverUrl, statusEl, 30);

        if (entries.length === 0) {
            renderFallbackReferralsTable('No e-Referral ServiceRequests found on server. Displaying sample list.');
            return;
        }

        loadedReferralsCache = entries.map(e => {
            const r = e.resource;
            const pRef = r.subject ? r.subject.reference : '';
            const pDisplay = (r.subject && r.subject.display) ? r.subject.display : '';
            let pName = getPatientNameById(pRef);
            if ((!pName || pName.startsWith('Patient ')) && pDisplay) {
                pName = pDisplay;
            }
            const reqRef = r.requester ? r.requester.reference : '';

            let perfOrgRef = '';
            let perfRoleRef = '';
            if (r.performer && Array.isArray(r.performer)) {
                r.performer.forEach(perf => {
                    const refStr = perf.reference || '';
                    if (refStr.startsWith('Organization/') || (!perfOrgRef && !refStr.startsWith('PractitionerRole/'))) {
                        perfOrgRef = refStr;
                    }
                    if (refStr.startsWith('PractitionerRole/')) {
                        perfRoleRef = refStr;
                    }
                });
            }

            if (!perfOrgRef && perfRoleRef) {
                perfOrgRef = getOrgRefFromRoleRef(perfRoleRef);
            }

            let sendOrgRef = '';
            let sendRoleRef = '';
            if (reqRef.startsWith('Organization/')) {
                sendOrgRef = reqRef;
            } else if (reqRef.startsWith('PractitionerRole/')) {
                sendRoleRef = reqRef;
                sendOrgRef = getOrgRefFromRoleRef(reqRef) || reqRef;
            } else if (reqRef) {
                sendOrgRef = reqRef;
            }

            let ccText = '';
            let codeVal = 'I10';
            let codeDisp = 'Essential hypertension';

            if (r.reasonCode && Array.isArray(r.reasonCode)) {
                r.reasonCode.forEach(rc => {
                    if (rc.text && !ccText) {
                        ccText = rc.text;
                    }
                    if (rc.coding && Array.isArray(rc.coding)) {
                        rc.coding.forEach(coding => {
                            if (coding.system && coding.system.includes('icd-10')) {
                                codeVal = coding.code || codeVal;
                                codeDisp = coding.display || codeDisp;
                            } else if (coding.code === '422843007' || coding.display === 'Chief complaint') {
                                if (rc.text) ccText = rc.text;
                            }
                        });
                    }
                });
            }

            const encRef = r.encounter ? r.encounter.reference : '';
            const authoredOn = r.authoredOn || '';
            const lastUpdated = (r.meta && r.meta.lastUpdated) ? r.meta.lastUpdated : authoredOn;
            const timestamp = authoredOn || lastUpdated || '';

            return {
                id: r.id,
                patientRef: pRef,
                patientName: pName,
                encounterRef: encRef,
                sendingOrgRef: sendOrgRef,
                sendingRoleRef: sendRoleRef,
                receivingOrgRef: perfOrgRef,
                receivingRoleRef: perfRoleRef,
                chiefComplaint: ccText,
                icdCode: codeVal,
                icdDisplay: codeDisp,
                priority: r.priority || 'routine',
                status: r.status || 'active',
                note: (r.note && r.note[0]) ? r.note[0].text : '',
                authoredOn: authoredOn,
                lastUpdated: lastUpdated,
                timestamp: timestamp,
                rawResource: r
            };
        });

        sortReferralsDescending(loadedReferralsCache);
        applyReferralFilters();
        fetchMissingRoleOrganizations(loadedReferralsCache);

        if (statusEl) statusEl.textContent = `✅ Loaded ${loadedReferralsCache.length} e-Referral(s) (Sorted Descending).`;
    } catch (err) {
        console.warn('Error fetching referrals from server:', err.message);
        renderFallbackReferralsTable(`⚠️ Server offline/timed out. Displaying sample e-Referrals list.`);
    }
}

function renderFallbackReferralsTable(message) {
    const statusEl = document.getElementById('referralsListStatus');
    if (statusEl && message) statusEl.textContent = message;

    loadedReferralsCache = FALLBACK_REFERRALS;
    sortReferralsDescending(loadedReferralsCache);
    applyReferralFilters();
}

/**
 * Sort e-Referrals in DESCENDING order
 */
function sortReferralsDescending(rolesArray) {
    if (!rolesArray || !Array.isArray(rolesArray)) return;

    rolesArray.sort((a, b) => {
        const timeAStr = a.timestamp || a.authoredOn || a.lastUpdated;
        const timeBStr = b.timestamp || b.authoredOn || b.lastUpdated;
        const timeA = timeAStr ? new Date(timeAStr).getTime() : 0;
        const timeB = timeBStr ? new Date(timeBStr).getTime() : 0;

        if (timeA !== timeB && !isNaN(timeA) && !isNaN(timeB) && timeA > 0 && timeB > 0) {
            return timeB - timeA;
        }

        const idA = (a.id || '').toString();
        const idB = (b.id || '').toString();
        const numA = parseInt(idA.replace(/\D/g, ''), 10);
        const numB = parseInt(idB.replace(/\D/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numB - numA;

        return idB.localeCompare(idA);
    });
}

/**
 * Populate Organization Filter Dropdown
 */
function populateOrganizationFilterDropdown(organizations) {
    const filterOrgSelect = document.getElementById('filterRoleOrganization');
    if (!filterOrgSelect) return;

    const currentValue = filterOrgSelect.value;
    filterOrgSelect.innerHTML = '<option value="">All Organizations</option>';

    const uniqueOrgMap = new Map();

    loadedOrganizationsCache.forEach(o => {
        if (o && o.id) uniqueOrgMap.set(o.id, o.name || o.id);
    });

    FALLBACK_ORGANIZATIONS.forEach(o => {
        if (o && o.id && !uniqueOrgMap.has(o.id)) uniqueOrgMap.set(o.id, o.name);
    });

    uniqueOrgMap.forEach((name, id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        filterOrgSelect.appendChild(option);
    });

    if (currentValue) filterOrgSelect.value = currentValue;
    initSelect2('filterRoleOrganization', 'All Organizations');
}

let currentDirectoryTab = 'all';
let currentSelectedModalRef = null;

/**
 * Set Active Directory Tab (All, Inbox, Outbox)
 */
function setDirectoryTab(tabName) {
    currentDirectoryTab = tabName || 'all';
    ['all', 'inbox', 'outbox'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (btn) {
            if (t === currentDirectoryTab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
    applyReferralFilters();
}

/**
 * Apply Filters to e-Referral Directory
 */
function applyReferralFilters() {
    const searchFilter = (document.getElementById('filterSearch')?.value || '').trim().toLowerCase();
    const orgFilter = (document.getElementById('filterRoleOrganization')?.value || '').trim().toLowerCase();
    const priorityFilter = document.getElementById('filterPriority')?.value || '';

    const targetOrgFilter = extractResourceTargetId(orgFilter);

    filteredReferralsCache = loadedReferralsCache.filter(ref => {
        const id = (ref.id || '').toLowerCase();
        const patientRef = (ref.patientRef || '').toLowerCase();
        const patientName = (ref.patientName || '').toLowerCase();
        const sendOrgRef = (ref.sendingOrgRef || '').toLowerCase();
        const recvOrgRef = (ref.receivingOrgRef || '').toLowerCase();
        const ccText = (ref.chiefComplaint || '').toLowerCase();
        const icd = (ref.icdCode || '').toLowerCase();
        const icdDisp = (ref.icdDisplay || '').toLowerCase();
        const timeStr = (ref.timestamp || ref.authoredOn || ref.lastUpdated || '').toLowerCase();

        // 1. Tab Filtering (Inbox vs Outbox vs All)
        const recvOrgId = extractResourceTargetId(ref.receivingOrgRef);
        const recvRoleOrgRef = getOrgRefFromRoleRef(ref.receivingRoleRef);
        const recvRoleOrgId = extractResourceTargetId(recvRoleOrgRef);
        const matchesRecvOrg = !targetOrgFilter || 
            (recvOrgId === targetOrgFilter) || 
            (recvRoleOrgId === targetOrgFilter) || 
            (ref.receivingOrgRef || '').toLowerCase().includes(orgFilter) || 
            (ref.receivingRoleRef || '').toLowerCase().includes(orgFilter);

        const sendOrgId = extractResourceTargetId(ref.sendingOrgRef);
        const sendRoleOrgRef = getOrgRefFromRoleRef(ref.sendingRoleRef || ref.sendingOrgRef);
        const sendRoleOrgId = extractResourceTargetId(sendRoleOrgRef);
        const matchesSendOrg = !targetOrgFilter || 
            (sendOrgId === targetOrgFilter) || 
            (sendRoleOrgId === targetOrgFilter) || 
            (ref.sendingOrgRef || '').toLowerCase().includes(orgFilter) || 
            (ref.sendingRoleRef || '').toLowerCase().includes(orgFilter);

        if (currentDirectoryTab === 'inbox') {
            if (orgFilter && !matchesRecvOrg) return false;
        } else if (currentDirectoryTab === 'outbox') {
            if (orgFilter && !matchesSendOrg) return false;
        } else {
            if (orgFilter && !matchesRecvOrg && !matchesSendOrg) {
                return false;
            }
        }

        // 2. Search Filter
        if (searchFilter && !id.includes(searchFilter) && !patientRef.includes(searchFilter) && !patientName.includes(searchFilter) && !ccText.includes(searchFilter) && !icd.includes(searchFilter) && !icdDisp.includes(searchFilter) && !timeStr.includes(searchFilter)) {
            return false;
        }

        // 3. Priority Filter
        if (priorityFilter && ref.priority !== priorityFilter) {
            return false;
        }

        return true;
    });

    currentReferralPage = 1;
    renderPaginatedReferralsTable();
}

function clearReferralFilters() {
    const searchInput = document.getElementById('filterSearch');
    const orgSelect = document.getElementById('filterRoleOrganization');
    const prioritySelect = document.getElementById('filterPriority');

    if (searchInput) searchInput.value = '';
    if (orgSelect) {
        orgSelect.value = '';
        if (window.jQuery && $.fn && $.fn.select2) {
            $('#filterRoleOrganization').val('').trigger('change.select2');
        }
    }
    if (prioritySelect) prioritySelect.value = '';

    applyReferralFilters();
}

function changeReferralPageSize(newSize) {
    referralPageSize = parseInt(newSize, 10) || 5;
    currentReferralPage = 1;
    renderPaginatedReferralsTable();
}

function goToReferralPage(pageNumber) {
    const totalPages = Math.ceil(filteredReferralsCache.length / referralPageSize) || 1;
    if (pageNumber < 1) pageNumber = 1;
    if (pageNumber > totalPages) pageNumber = totalPages;
    currentReferralPage = pageNumber;
    renderPaginatedReferralsTable();
}

function renderPaginatedReferralsTable() {
    const totalItems = filteredReferralsCache.length;
    const totalPages = Math.ceil(totalItems / referralPageSize) || 1;

    if (currentReferralPage > totalPages) currentReferralPage = totalPages;

    const startIndex = (currentReferralPage - 1) * referralPageSize;
    const endIndex = Math.min(startIndex + referralPageSize, totalItems);
    const pageItems = filteredReferralsCache.slice(startIndex, endIndex);

    renderReferralsTable(pageItems);

    const infoEl = document.getElementById('referralPaginationInfo');
    if (infoEl) {
        infoEl.textContent = totalItems === 0 ? 'Showing 0 to 0 of 0 entries' : `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} entries`;
    }

    const buttonsContainer = document.getElementById('referralPaginationButtons');
    if (buttonsContainer) {
        let html = `<button type="button" class="btn-small" ${currentReferralPage <= 1 ? 'disabled' : ''} onclick="goToReferralPage(${currentReferralPage - 1})">◀ Prev</button>`;
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentReferralPage - 1 && i <= currentReferralPage + 1)) {
                const isActive = i === currentReferralPage;
                html += `<button type="button" class="btn-small ${isActive ? 'btn-submit' : ''}" style="${isActive ? 'width:auto; padding:0.4rem 0.7rem;' : ''}" onclick="goToReferralPage(${i})">${i}</button>`;
            } else if (i === currentReferralPage - 2 || i === currentReferralPage + 2) {
                html += `<span style="align-self:center; font-size:0.85rem;">...</span>`;
            }
        }
        html += `<button type="button" class="btn-small" ${currentReferralPage >= totalPages ? 'disabled' : ''} onclick="goToReferralPage(${currentReferralPage + 1})">Next ▶</button>`;
        buttonsContainer.innerHTML = html;
    }
}

function renderReferralsTable(referrals) {
    const tbody = document.getElementById('referralsListTableBody');
    if (!tbody) return;

    if (!referrals || referrals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No matching e-Referrals found.</td></tr>';
        return;
    }

    let html = '';
    referrals.forEach(ref => {
        const id = ref.id || 'N/A';
        let pName = ref.patientName;
        const resolvedName = getPatientNameById(ref.patientRef);
        if (resolvedName && !resolvedName.startsWith('Patient ') && resolvedName !== 'N/A') {
            pName = resolvedName;
        } else if (!pName) {
            pName = resolvedName;
        }
        const sendOrg = getOrgNameById(ref.sendingOrgRef);
        const recvOrg = getOrgNameById(ref.receivingOrgRef);
        const timestampHtml = formatReferralTimestamp(ref.timestamp || ref.authoredOn || ref.lastUpdated);

        const ccHtml = ref.chiefComplaint ? `<div style="font-weight:600; color:#0f172a; margin-bottom:0.15rem;">🗣️ ${ref.chiefComplaint}</div>` : '';
        const icdHtml = `<div style="font-size:0.82rem; color:#475569;">🩺 <code>${ref.icdCode}</code> - ${ref.icdDisplay}</div>`;
        const disHtml = ref.disability ? `<div style="font-size:0.78rem; color:#d97706; font-weight:600; margin-top:0.15rem;">♿ ${ref.disability}</div>` : '';
        const diagCell = `${ccHtml}${icdHtml}${disHtml}`;

        const prioLower = ref.priority ? ref.priority.toLowerCase() : 'routine';
        const prioText = prioLower.toUpperCase();
        let prioBadge = 'badge-success';
        if (prioLower === 'stat') prioBadge = 'badge-danger';
        else if (prioLower === 'urgent' || prioLower === 'asap') prioBadge = 'badge-warning';

        const statusHtml = getStatusBadgeHtml(ref.status);
        const refStatus = (ref.status || 'active').toLowerCase();

        html += `
            <tr>
                <td><code>${id}</code></td>
                <td>${timestampHtml}</td>
                <td><strong>${pName}</strong><br><small style="color:var(--muted-text);">${ref.patientRef}</small></td>
                <td>${sendOrg}</td>
                <td>${recvOrg}</td>
                <td>${diagCell}</td>
                <td>
                    <span class="badge ${prioBadge}" title="Priority">${prioText}</span>
                    <div style="margin-top:0.25rem;">${statusHtml}</div>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:0.35rem;">
                        <div style="display:flex; gap:0.35rem;">
                            <button type="button" class="btn-small" onclick="openReferralDetailsModal('${id}')" title="View Full Details & Status">🔍 Details</button>
                            <button type="button" class="btn-small" onclick="viewReferralJson('${id}')" title="View FHIR JSON">📄 JSON</button>
                        </div>
                        <button type="button" class="btn-small" style="background:#0284c7; color:white; font-weight:600; border-color:#0284c7;" onclick="openChangeStatusModal('${id}')" title="Change Referral Status & Add Remarks">⚡ Change Status</button>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

/**
 * Open Referral Details Modal
 */
function openReferralDetailsModal(referralId) {
    const ref = loadedReferralsCache.find(r => r.id === referralId);
    if (!ref) {
        alert('Referral record not found.');
        return;
    }

    currentSelectedModalRef = ref;
    const modalTitle = document.getElementById('modalReferralTitle');
    const modalBody = document.getElementById('modalReferralBody');
    const modalEl = document.getElementById('referralDetailsModal');

    if (modalTitle) modalTitle.textContent = `📋 e-Referral Details (${ref.id})`;

    let pName = ref.patientName;
    const resolvedName = getPatientNameById(ref.patientRef);
    if (resolvedName && !resolvedName.startsWith('Patient ') && resolvedName !== 'N/A') {
        pName = resolvedName;
    } else if (!pName) {
        pName = resolvedName;
    }
    const sendOrg = getOrgNameById(ref.sendingOrgRef);
    const recvOrg = getOrgNameById(ref.receivingOrgRef);
    const prioLower = ref.priority ? ref.priority.toLowerCase() : 'routine';
    const prioText = prioLower.toUpperCase();
    let prioBadge = 'badge-success';
    if (prioLower === 'stat') prioBadge = 'badge-danger';
    else if (prioLower === 'urgent' || prioLower === 'asap') prioBadge = 'badge-warning';

    const statusHtml = getStatusBadgeHtml(ref.status);
    const refStatus = (ref.status || 'active').toLowerCase();

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem; background:#ffffff; padding:0.75rem; border-radius:0.375rem; border:1px solid var(--border-color);">
            <div>
                <span style="font-weight:700; font-size:1.1rem; color:var(--primary-color);">Referral ID: <code>${ref.id}</code></span>
                <span style="font-size:0.8rem; color:var(--muted-text); margin-left:0.5rem;">Created/Updated: ${ref.lastUpdated ? new Date(ref.lastUpdated).toLocaleString() : 'N/A'}</span>
            </div>
            <div style="display:flex; gap:0.35rem; align-items:center;">
                <span class="badge ${prioBadge}" style="font-size:0.85rem; padding:0.3rem 0.6rem;">${prioText} PRIORITY</span>
                ${statusHtml}
            </div>
        </div>

        <!-- Referral Status & Remarks Bar -->
        <div style="background:#f0f9ff; border:1px solid #7dd3fc; border-radius:0.375rem; padding:0.75rem; margin-bottom:1rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
            <div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <strong style="color:#0369a1; font-size:0.9rem;">⚡ Referral Processing Status:</strong>
                    ${statusHtml}
                </div>
                ${(ref.statusRemarks || ref.note) ? `<div style="font-size:0.83rem; color:#0284c7; margin-top:0.35rem;">💬 <strong>Status Remarks:</strong> ${ref.statusRemarks || ref.note}</div>` : ''}
            </div>
            <div>
                <button type="button" class="btn-small" style="background:#0284c7; color:white; font-weight:600; border-color:#0284c7; padding:0.4rem 0.8rem;" onclick="openChangeStatusModal('${ref.id}')">⚡ Change Status & Remarks</button>
            </div>
        </div>

        <!-- 1. Patient Info -->
        <div class="detail-section">
            <div class="detail-section-title">👤 Patient Information & Encounter</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:0.5rem;">
                <div><strong>Full Name:</strong> ${pName}</div>
                <div><strong>Patient Reference:</strong> <code>${ref.patientRef || 'N/A'}</code></div>
                <div><strong>Encounter Reference:</strong> <code>${ref.encounterRef || 'urn:uuid:encounter'}</code></div>
                <div><strong>Encounter Class / Status:</strong> <code>${ref.encounterClass || 'AMB'}</code> / <code>${ref.encounterStatus || 'finished'}</code></div>
            </div>
        </div>

        <!-- 2. Facilities & Practitioner Roles -->
        <div class="detail-section">
            <div class="detail-section-title">🏥 Facilities & Practitioner Roles (Sending vs Receiving)</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:0.75rem;">
                <div style="background:#ffffff; padding:0.6rem; border-radius:0.25rem; border:1px solid var(--border-color);">
                    <div style="font-weight:600; color:var(--primary-color); font-size:0.85rem;">🏥 Where From (Sending Facility)</div>
                    <div style="font-weight:700; margin-top:0.2rem;">${sendOrg}</div>
                    <div style="font-size:0.8rem; color:var(--muted-text);">Facility Ref: <code>${ref.sendingOrgRef || 'N/A'}</code></div>
                    <div style="margin-top:0.35rem; font-size:0.85rem;"><strong>Sending PractitionerRole:</strong><br><code>${ref.sendingRoleRef || 'N/A'}</code></div>
                </div>
                <div style="background:#ffffff; padding:0.6rem; border-radius:0.25rem; border:1px solid var(--border-color);">
                    <div style="font-weight:600; color:var(--primary-color); font-size:0.85rem;">🏥 Where To (Receiving Facility)</div>
                    <div style="font-weight:700; margin-top:0.2rem;">${recvOrg}</div>
                    <div style="font-size:0.8rem; color:var(--muted-text);">Facility Ref: <code>${ref.receivingOrgRef || 'N/A'}</code></div>
                    <div style="margin-top:0.35rem; font-size:0.85rem;"><strong>Receiving PractitionerRole:</strong><br><code>${ref.receivingRoleRef || 'N/A'}</code></div>
                </div>
            </div>
        </div>

        <!-- 3. Clinical Reason & Diagnosis -->
        <div class="detail-section">
            <div class="detail-section-title">🩺 Clinical Details & Diagnosis</div>
            <div style="margin-bottom:0.5rem;">
                <strong>🗣️ Chief Complaint:</strong> ${ref.chiefComplaint || 'None recorded'}
            </div>
            <div style="margin-bottom:0.5rem;">
                <strong>🩺 ICD-10 Code & Diagnosis:</strong> <code>${ref.icdCode || 'I10'}</code> - ${ref.icdDisplay || 'Hypertension'}
            </div>
            <div style="margin-bottom:0.5rem;">
                <strong>🏷️ Referral Category:</strong> ${ref.category || 'Specialist Evaluation Procedure (386053000)'}
            </div>
            <div>
                <strong>📝 Clinical Summary / Referral Note:</strong> ${ref.note || 'No clinical notes recorded.'}
            </div>
        </div>

        <!-- 4. Disability & Accommodations -->
        ${ref.disability ? `
        <div class="detail-section" style="border-color:#fef08a; background:#fffbeb;">
            <div class="detail-section-title" style="color:#b45309;">♿ Disability Status & Accommodations (LOINC 8479-3)</div>
            <div><strong>Disability Details:</strong> ${ref.disability}</div>
        </div>
        ` : ''}

        <!-- 5. Vital Signs Observations (LOINC) -->
        <div class="detail-section">
            <div class="detail-section-title">📊 Recorded Vital Signs Observations (LOINC Coded)</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:0.5rem; text-align:center;">
                <div style="background:#ffffff; padding:0.5rem; border-radius:0.25rem; border:1px solid var(--border-color);">
                    <div style="font-size:0.75rem; color:var(--muted-text);">Body Temp (8310-5)</div>
                    <div style="font-weight:700; font-size:1rem; color:var(--primary-color);">36.8 °C</div>
                </div>
                <div style="background:#ffffff; padding:0.5rem; border-radius:0.25rem; border:1px solid var(--border-color);">
                    <div style="font-size:0.75rem; color:var(--muted-text);">Heart Rate (8867-4)</div>
                    <div style="font-weight:700; font-size:1rem; color:var(--primary-color);">78 bpm</div>
                </div>
                <div style="background:#ffffff; padding:0.5rem; border-radius:0.25rem; border:1px solid var(--border-color);">
                    <div style="font-size:0.75rem; color:var(--muted-text);">Resp Rate (9279-1)</div>
                    <div style="font-weight:700; font-size:1rem; color:var(--primary-color);">18 /min</div>
                </div>
                <div style="background:#ffffff; padding:0.5rem; border-radius:0.25rem; border:1px solid var(--border-color);">
                    <div style="font-size:0.75rem; color:var(--muted-text);">Blood Pressure (85354-9)</div>
                    <div style="font-weight:700; font-size:1rem; color:var(--primary-color);">130/85 mmHg</div>
                </div>
                <div style="background:#ffffff; padding:0.5rem; border-radius:0.25rem; border:1px solid var(--border-color);">
                    <div style="font-size:0.75rem; color:var(--muted-text);">SpO2 (59408-5)</div>
                    <div style="font-weight:700; font-size:1rem; color:var(--primary-color);">98 %</div>
                </div>
            </div>
        </div>
    `;

    if (modalBody) modalBody.innerHTML = html;
    if (modalEl) modalEl.style.display = 'flex';
}

function closeReferralDetailsModal() {
    const modalEl = document.getElementById('referralDetailsModal');
    if (modalEl) modalEl.style.display = 'none';
}

function copyModalReferralJson() {
    if (!currentSelectedModalRef) return;
    navigator.clipboard.writeText(JSON.stringify(currentSelectedModalRef, null, 2)).then(() => {
        alert('e-Referral Record JSON copied to clipboard!');
    }).catch(err => {
        alert('Failed to copy JSON: ' + err.message);
    });
}

function viewReferralJson(referralId) {
    const ref = loadedReferralsCache.find(r => r.id === referralId);
    if (!ref) {
        alert('Referral record not found.');
        return;
    }

    let serviceRequestJson = ref.rawResource;

    if (!serviceRequestJson) {
        const performers = [];
        if (ref.receivingOrgRef) performers.push({ "reference": ref.receivingOrgRef });
        if (ref.receivingRoleRef) performers.push({ "reference": ref.receivingRoleRef });

        const reqRef = ref.sendingRoleRef || ref.sendingOrgRef || 'Organization/PGH-ORG-001';

        serviceRequestJson = {
            "resourceType": "ServiceRequest",
            "id": ref.id,
            "meta": {
                "versionId": "1",
                "lastUpdated": ref.lastUpdated || new Date().toISOString(),
                "profile": [
                    "https://www.fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request"
                ]
            },
            "requisition": {
                "system": "http://fhir.doh.gov.ph/NamingSystem/ph-ereferral-number",
                "value": ref.requisition || `REF-${ref.id}`
            },
            "status": ref.status || "active",
            "intent": "order",
            "category": [
                {
                    "coding": [
                        {
                            "system": "http://snomed.info/sct",
                            "code": "440655000",
                            "display": "Outpatient"
                        }
                    ],
                    "text": "Outpatient"
                }
            ],
            "code": {
                "text": "Consultation"
            },
            "subject": {
                "reference": ref.patientRef || "Patient/1001"
            },
            "encounter": {
                "reference": ref.encounterRef || `Encounter/${ref.id}-ENC`
            },
            "authoredOn": ref.lastUpdated || new Date().toISOString(),
            "requester": {
                "reference": reqRef
            },
            "performer": performers.length > 0 ? performers : [{ "reference": "Organization/SLMC-ORG-002" }],
            "reasonCode": [
                {
                    "coding": [
                        {
                            "system": "http://snomed.info/sct",
                            "code": ref.icdCode || "I10",
                            "display": ref.icdDisplay || "Essential hypertension"
                        }
                    ],
                    "text": ref.chiefComplaint ? `${ref.chiefComplaint} (ICD-10: ${ref.icdCode || 'I10'} - ${ref.icdDisplay || 'Essential hypertension'})` : (ref.icdDisplay || "Essential hypertension")
                }
            ]
        };

        if (ref.note || ref.statusRemarks) {
            serviceRequestJson["note"] = [{ "text": ref.statusRemarks || ref.note }];
        }
    }

    const modalEl = document.getElementById('referralJsonModal');
    const modalCodeEl = document.getElementById('modalReferralJsonCode');
    const modalTitleEl = document.getElementById('modalReferralJsonTitle');

    if (modalEl && modalCodeEl) {
        if (modalTitleEl) modalTitleEl.textContent = `📄 ServiceRequest FHIR Resource JSON (ID: ${ref.id})`;
        modalCodeEl.textContent = JSON.stringify(serviceRequestJson, null, 2);
        modalEl.style.display = 'flex';
        currentSelectedModalRef = serviceRequestJson;
    } else {
        alert(`e-Referral ServiceRequest FHIR Resource JSON (ID: ${referralId}):\n\n` + JSON.stringify(serviceRequestJson, null, 2));
    }
}

function closeReferralJsonModal() {
    const modalEl = document.getElementById('referralJsonModal');
    if (modalEl) modalEl.style.display = 'none';
}

function copyReferralJsonModalText() {
    const codeEl = document.getElementById('modalReferralJsonCode');
    if (!codeEl) return;
    navigator.clipboard.writeText(codeEl.textContent).then(() => {
        alert('ServiceRequest FHIR Resource JSON copied to clipboard!');
    }).catch(err => {
        alert('Failed to copy JSON: ' + err.message);
    });
}

// Copy JSON to clipboard
function copyJsonPreview() {
    const previewEl = document.getElementById('jsonPreview');
    if (!previewEl) return;
    navigator.clipboard.writeText(previewEl.textContent).then(() => {
        alert('e-Referral Transaction Bundle JSON copied to clipboard!');
    }).catch(err => {
        alert('Failed to copy JSON: ' + err.message);
    });
}

// Download JSON file
function downloadJsonFile() {
    const jsonObj = buildEreferralBundleJSON();
    const jsonText = JSON.stringify(jsonObj, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ereferral_transaction_bundle.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Event Listeners on DOM load
document.addEventListener('DOMContentLoaded', () => {
    updateJsonPreview();

    const form = document.getElementById('ereferralForm');
    if (form) {
        form.addEventListener('input', updateJsonPreview);
        form.addEventListener('change', updateJsonPreview);
        form.addEventListener('submit', submitEreferralBundle);
    }

    const serverPresetSelect = document.getElementById('serverPresetSelect');
    const fhirServerInput = document.getElementById('fhirServerUrl');
    if (serverPresetSelect && fhirServerInput) {
        serverPresetSelect.addEventListener('change', () => {
            if (serverPresetSelect.value) {
                fhirServerInput.value = serverPresetSelect.value;
                fetchPatients();
                fetchOrganizations();
                fetchPractitionerRoles();
                fetchAndRenderReferrals();
            }
        });
    }

    initSelect2('icdSelect', '-- Select ICD-10 Diagnosis --');
    initSelect2('filterRoleOrganization', 'All Organizations');

    if (window.jQuery) {
        $('#patientSelect, #sendingOrgSelect, #sendingRoleSelect, #receivingOrgSelect, #receivingRoleSelect, #icdSelect').on('change select2:select', updateJsonPreview);
        $('#sendingOrgSelect').on('change select2:select', onSendingOrgChange);
        $('#receivingOrgSelect').on('change select2:select', onReceivingOrgChange);
        $('#icdSelect').on('change select2:select', handleIcdSelectChange);
    }

    fetchPatients();
    fetchOrganizations();
    fetchPractitionerRoles();
    fetchAndRenderReferrals();
});
