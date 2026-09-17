/**
 * Network Overview dashboard for the home page.
 * Reads from the FHIR server via src/shared/fhirConfig.js helpers.
 * Every card renders independently as its own data resolves, and degrades
 * to an inline "Data unavailable" note on failure rather than blocking
 * the rest of the page.
 */

const REFERRAL_STATUSES = [
    { key: 'active', label: 'Active', bg: '#dcfce7', fg: '#166534' },
    { key: 'completed', label: 'Completed', bg: '#dbeafe', fg: '#1e40af' },
    { key: 'on-hold', label: 'On Hold', bg: '#fef3c7', fg: '#92400e' },
    { key: 'draft', label: 'Draft', bg: '#f1f5f9', fg: '#475569' },
    { key: 'revoked', label: 'Revoked', bg: '#fee2e2', fg: '#991b1b' },
    { key: 'entered-in-error', label: 'In Error', bg: '#fee2e2', fg: '#991b1b' }
];

const RESOURCE_ICONS = {
    Patient: '\u{1F464}',
    Organization: '\u{1F3DB}',
    Practitioner: '\u{1F9BA}',
    PractitionerRole: '\u{1F4CB}',
    ServiceRequest: '\u{1F4E4}'
};

const CHART_BLUE = '#2563eb';
const CHART_PALETTE = ['#2563eb', '#93c5fd', '#a7f3d0', '#fde68a', '#fca5a5', '#c4b5fd'];

const dashboardCharts = {};

function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setUnavailable(id) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = 'N/A';
        el.title = 'Data unavailable — could not reach the FHIR server';
        el.classList.add('stat-unavailable');
    }
}

function setChartNote(id, message) {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
}

function renderBarList(containerId, items, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = `<div class="bar-list-empty">${emptyMessage || 'No data available.'}</div>`;
        return;
    }

    const max = Math.max(...items.map(i => i.value), 1);
    container.innerHTML = items.map(item => `
        <div class="bar-row">
            <div class="bar-row-label" title="${item.label}">${item.label}</div>
            <div class="bar-row-track">
                <div class="bar-row-fill" style="width:${Math.max(4, (item.value / max) * 100)}%"></div>
            </div>
            <div class="bar-row-value">${item.value}</div>
        </div>
    `).join('');
}

function renderDonut(canvasId, labels, data, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    if (dashboardCharts[canvasId]) {
        dashboardCharts[canvasId].destroy();
    }

    dashboardCharts[canvasId] = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

function renderHorizontalBar(canvasId, labels, data, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    if (dashboardCharts[canvasId]) {
        dashboardCharts[canvasId].destroy();
    }

    dashboardCharts[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const then = new Date(isoString).getTime();
    if (Number.isNaN(then)) return '';
    const diffMs = Date.now() - then;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

function calculateAge(birthDate) {
    if (!birthDate) return null;
    const birth = new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

/* ----------------------------------------------------------------------
   Tier 1: total counts
   ---------------------------------------------------------------------- */

async function loadTotalCounts() {
    const resources = [
        { type: 'Patient', statId: 'stat-patient' },
        { type: 'Organization', statId: 'stat-organization' },
        { type: 'Practitioner', statId: 'stat-practitioner' },
        { type: 'PractitionerRole', statId: 'stat-practitionerrole' },
        { type: 'ServiceRequest', statId: 'stat-servicerequest' }
    ];

    const results = await Promise.allSettled(
        resources.map(r => fetchSummaryCount(r.type))
    );

    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            setStat(resources[i].statId, result.value.toLocaleString());
        } else {
            setUnavailable(resources[i].statId);
        }
    });

    return results.every(r => r.status === 'fulfilled');
}

/* ----------------------------------------------------------------------
   Tier 2: cheap category breakdowns
   ---------------------------------------------------------------------- */

async function loadPatientGenderSplit() {
    const genders = ['male', 'female', 'other', 'unknown'];
    try {
        const counts = await Promise.all(genders.map(g => fetchSummaryCount('Patient', `gender=${g}`)));
        const labels = ['Male', 'Female', 'Other', 'Unknown'];
        const nonZero = counts.some(c => c > 0);
        if (!nonZero) {
            setChartNote('note-patientGender', 'Gender data not available.');
            return;
        }
        renderDonut('chartPatientGender', labels, counts, CHART_PALETTE);
        setChartNote('note-patientGender', '');
    } catch (err) {
        setChartNote('note-patientGender', 'Data unavailable.');
    }
}

async function loadOrgStatus() {
    try {
        const [active, inactive] = await Promise.all([
            fetchSummaryCount('Organization', 'active=true'),
            fetchSummaryCount('Organization', 'active=false')
        ]);
        renderDonut('chartOrgStatus', ['Active', 'Inactive'], [active, inactive], [CHART_BLUE, '#e5e7eb']);
        setChartNote('note-orgStatus', '');
    } catch (err) {
        setChartNote('note-orgStatus', 'Data unavailable.');
    }
}

async function loadRoleStatus() {
    try {
        const [active, inactive] = await Promise.all([
            fetchSummaryCount('PractitionerRole', 'active=true'),
            fetchSummaryCount('PractitionerRole', 'active=false')
        ]);
        renderDonut('chartRoleStatus', ['Active', 'Inactive'], [active, inactive], [CHART_BLUE, '#e5e7eb']);
        setChartNote('note-roleStatus', '');
    } catch (err) {
        setChartNote('note-roleStatus', 'Data unavailable.');
    }
}

async function loadReferralFunnel() {
    try {
        const counts = await Promise.all(
            REFERRAL_STATUSES.map(s => fetchSummaryCount('ServiceRequest', `status=${s.key}`))
        );
        renderHorizontalBar(
            'chartReferralFunnel',
            REFERRAL_STATUSES.map(s => s.label),
            counts,
            REFERRAL_STATUSES.map(s => s.fg)
        );
    } catch (err) {
        setChartNote('note-referralFunnel', 'Data unavailable.');
    }
}

/* ----------------------------------------------------------------------
   Tier 3: breakdowns needing full resource bodies
   ---------------------------------------------------------------------- */

async function loadPatientAgeBands() {
    try {
        const entries = await fetchAllFhirResources('Patient');
        const bands = [
            { label: '0-17', min: 0, max: 17, value: 0 },
            { label: '18-34', min: 18, max: 34, value: 0 },
            { label: '35-49', min: 35, max: 49, value: 0 },
            { label: '50-64', min: 50, max: 64, value: 0 },
            { label: '65+', min: 65, max: Infinity, value: 0 }
        ];
        entries.forEach(e => {
            const age = calculateAge(e.resource && e.resource.birthDate);
            if (age === null) return;
            const band = bands.find(b => age >= b.min && age <= b.max);
            if (band) band.value++;
        });
        renderBarList('barPatientAge', bands.map(b => ({ label: b.label, value: b.value })));
    } catch (err) {
        renderBarList('barPatientAge', [], 'Data unavailable.');
    }
}

async function loadOrgTypesAndGaps(sharedState) {
    try {
        const entries = await fetchAllFhirResources('Organization');
        sharedState.organizations = entries.map(e => e.resource).filter(Boolean);

        const typeCounts = {};
        sharedState.organizations.forEach(org => {
            const types = (org.type || []);
            if (types.length === 0) {
                typeCounts['Unspecified'] = (typeCounts['Unspecified'] || 0) + 1;
                return;
            }
            types.forEach(t => {
                const display = (t.coding && t.coding[0] && (t.coding[0].display || t.coding[0].code)) || 'Unspecified';
                typeCounts[display] = (typeCounts[display] || 0) + 1;
            });
        });

        const ranked = Object.entries(typeCounts)
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);

        renderBarList('barOrgTypes', ranked);
        sharedState.orgsReady.resolve();
    } catch (err) {
        renderBarList('barOrgTypes', [], 'Data unavailable.');
        sharedState.orgsReady.reject(err);
    }
}

async function loadRoleBreakdowns(sharedState) {
    try {
        const entries = await fetchAllFhirResources('PractitionerRole');
        sharedState.roles = entries.map(e => e.resource).filter(Boolean);

        const specialtyCounts = {};
        const orgStaffCounts = {};
        const activePractitionerRefs = new Set();
        const activeOrgRefs = new Set();

        sharedState.roles.forEach(role => {
            const isActive = role.active !== false;

            let codeDisplay = 'Unspecified';
            if (role.code && role.code[0] && role.code[0].coding && role.code[0].coding[0]) {
                codeDisplay = role.code[0].coding[0].display || role.code[0].coding[0].code || codeDisplay;
            }
            specialtyCounts[codeDisplay] = (specialtyCounts[codeDisplay] || 0) + 1;

            const orgRef = role.organization && role.organization.reference;
            if (orgRef) {
                orgStaffCounts[orgRef] = (orgStaffCounts[orgRef] || 0) + 1;
                if (isActive) activeOrgRefs.add(orgRef);
            }

            const practRef = role.practitioner && role.practitioner.reference;
            if (practRef) activePractitionerRefs.add(practRef);
        });

        const topSpecialties = Object.entries(specialtyCounts)
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);
        renderBarList('barSpecialties', topSpecialties);

        // Staffing per organization — resolve org names once organizations are ready
        sharedState.orgsReady.promise.then(() => {
            const staffingRanked = Object.entries(orgStaffCounts)
                .map(([ref, value]) => {
                    const id = ref.replace('Organization/', '');
                    const org = (sharedState.organizations || []).find(o => o.id === id);
                    return { label: org && org.name ? org.name : id, value };
                })
                .sort((a, b) => b.value - a.value)
                .slice(0, 8);
            renderBarList('barStaffing', staffingRanked);

            const orgsWithNoStaff = (sharedState.organizations || []).filter(
                org => !activeOrgRefs.has(`Organization/${org.id}`)
            ).length;
            setStat('gap-organizations', orgsWithNoStaff.toLocaleString());
        }).catch(() => {
            renderBarList('barStaffing', [], 'Data unavailable.');
            setUnavailable('gap-organizations');
        });

        // Practitioner gap — resolve once practitioners are ready
        sharedState.practitionersReady.promise.then(() => {
            const practitionersWithNoRole = (sharedState.practitioners || []).filter(
                p => !activePractitionerRefs.has(`Practitioner/${p.id}`)
            ).length;
            setStat('gap-practitioners', practitionersWithNoRole.toLocaleString());
        }).catch(() => {
            setUnavailable('gap-practitioners');
        });
    } catch (err) {
        renderBarList('barSpecialties', [], 'Data unavailable.');
        renderBarList('barStaffing', [], 'Data unavailable.');
        setUnavailable('gap-organizations');
        setUnavailable('gap-practitioners');
    }
}

async function loadPractitioners(sharedState) {
    try {
        const entries = await fetchAllFhirResources('Practitioner');
        sharedState.practitioners = entries.map(e => e.resource).filter(Boolean);
        sharedState.practitionersReady.resolve();
    } catch (err) {
        sharedState.practitionersReady.reject(err);
    }
}

function makeDeferred() {
    const d = {};
    d.promise = new Promise((resolve, reject) => {
        d.resolve = resolve;
        d.reject = reject;
    });
    return d;
}

/* ----------------------------------------------------------------------
   Tier 4: recent activity feed
   ---------------------------------------------------------------------- */

async function loadRecentActivity() {
    const container = document.getElementById('activityFeed');
    if (!container) return;

    const types = ['Patient', 'Organization', 'Practitioner', 'PractitionerRole', 'ServiceRequest'];
    const results = await Promise.allSettled(types.map(t => fetchRecentResources(t, 5)));

    let merged = [];
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            result.value.forEach(resource => merged.push({ resource, type: types[i] }));
        }
    });

    if (merged.length === 0) {
        container.innerHTML = '<div class="activity-empty">Recent activity unavailable — could not reach the FHIR server.</div>';
        return;
    }

    merged.sort((a, b) => {
        const at = (a.resource.meta && a.resource.meta.lastUpdated) || '';
        const bt = (b.resource.meta && b.resource.meta.lastUpdated) || '';
        return bt.localeCompare(at);
    });
    merged = merged.slice(0, 10);

    container.innerHTML = merged.map(item => {
        const icon = RESOURCE_ICONS[item.type] || '\u{1F4C4}';
        const lastUpdated = item.resource.meta && item.resource.meta.lastUpdated;
        const relTime = formatRelativeTime(lastUpdated);
        let extra = '';
        if (item.type === 'ServiceRequest') {
            const status = REFERRAL_STATUSES.find(s => s.key === (item.resource.status || 'active')) || REFERRAL_STATUSES[0];
            extra = `<span class="activity-badge" style="background:${status.bg};color:${status.fg}">${status.label}</span>`;
        }
        return `
            <div class="activity-row">
                <div class="activity-icon">${icon}</div>
                <div class="activity-body">
                    <div class="activity-title">${item.type} <code>${item.resource.id || ''}</code></div>
                    <div class="activity-time">${relTime}</div>
                </div>
                ${extra}
            </div>
        `;
    }).join('');
}

/* ----------------------------------------------------------------------
   Orchestration
   ---------------------------------------------------------------------- */

function setDashboardStatus(message) {
    const el = document.getElementById('dashboardStatus');
    if (el) el.textContent = message;
}

async function initDashboard() {
    setDashboardStatus('Connecting to FHIR server…');

    const sharedState = {
        organizations: [],
        roles: [],
        practitioners: [],
        orgsReady: makeDeferred(),
        practitionersReady: makeDeferred()
    };

    const tier1 = loadTotalCounts();

    const tier2 = Promise.allSettled([
        loadPatientGenderSplit(),
        loadOrgStatus(),
        loadRoleStatus(),
        loadReferralFunnel()
    ]);

    const tier3 = Promise.allSettled([
        loadPatientAgeBands(),
        loadOrgTypesAndGaps(sharedState),
        loadPractitioners(sharedState),
        loadRoleBreakdowns(sharedState)
    ]);

    const tier4 = loadRecentActivity();

    const [tier1Ok] = await Promise.all([tier1, tier2, tier3, tier4]);
    setDashboardStatus(tier1Ok ? 'Connected to FHIR server' : '⚠️ Some metrics unavailable — server slow or unreachable.');
}

document.addEventListener('DOMContentLoaded', initDashboard);
