// Controller - Practitioner CRUD
const FHIR_BASE = 'https://cdr.pheref.fhirlab.net/fhir';
const PAGE_SIZE = 10;

let currentPageNumber = 1;
let nextPageUrl = null;
let prevPageUrl = null;

function firstPageUrl() {
    return `${FHIR_BASE}/Practitioner?_sort=-_lastUpdated&_count=${PAGE_SIZE}&_total=accurate`;
}

async function fetchPractitionerPage(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load practitioners (${response.status})`);
    }
    const bundle = await response.json();
    const links = bundle.link || [];
    const findLink = rel => (links.find(l => l.relation === rel) || {}).url || null;

    return {
        practitioners: (bundle.entry || []).map(entry => Practitioner.fromFhirJson(entry.resource)),
        total: typeof bundle.total === 'number' ? bundle.total : (bundle.entry || []).length,
        nextUrl: findLink('next'),
        prevUrl: findLink('previous') || findLink('prev')
    };
}

async function createPractitioner(practitioner) {
    const response = await fetch(`${FHIR_BASE}/Practitioner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/fhir+json' },
        body: JSON.stringify(practitioner.toFhirJson())
    });
    if (!response.ok) {
        throw new Error(`Failed to create practitioner (${response.status})`);
    }
    return response.json();
}

async function updatePractitioner(practitioner) {
    const body = { ...practitioner.toFhirJson(), id: practitioner.id };
    const response = await fetch(`${FHIR_BASE}/Practitioner/${practitioner.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/fhir+json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        throw new Error(`Failed to update practitioner (${response.status})`);
    }
    return response.json();
}

async function deletePractitioner(id) {
    const response = await fetch(`${FHIR_BASE}/Practitioner/${id}`, {
        method: 'DELETE'
    });
    if (!response.ok) {
        throw new Error(`Failed to delete practitioner (${response.status})`);
    }
}

// --- DOM wiring ---
const statusEl = () => document.getElementById('status-message');
const showStatus = (message, isError = false) => {
    const el = statusEl();
    el.textContent = message;
    el.style.color = isError ? '#dc2626' : '#16a34a';
};
const clearStatus = () => {
    const el = statusEl();
    el.textContent = '';
};

const form = () => document.getElementById('practitioner-form');
const tableBody = () => document.getElementById('practitioner-table-body');

function fillForm(practitioner) {
    form()['practitioner-id'].value = practitioner.id || '';
    form()['family'].value = (practitioner.name && practitioner.name.family) || '';
    form()['given'].value = (practitioner.name && practitioner.name.given) || '';
    form()['qualification'].value = (practitioner.qualification && practitioner.qualification.text) || '';
    form()['telecom-system'].value = (practitioner.telecom && practitioner.telecom.system) || 'phone';
    form()['telecom-value'].value = (practitioner.telecom && practitioner.telecom.value) || '';
    document.getElementById('form-title').textContent = 'Edit Practitioner';
}

function resetForm() {
    form().reset();
    form()['practitioner-id'].value = '';
    document.getElementById('form-title').textContent = 'Add Practitioner';
}

function renderPractitioners(practitioners) {
    const body = tableBody();
    body.innerHTML = '';

    practitioners.forEach(p => {
        const fullName = [p.name && p.name.given, p.name && p.name.family].filter(Boolean).join(' ') || '(no name)';
        const qualification = (p.qualification && p.qualification.text) || '';
        const telecom = (p.telecom && p.telecom.value) || '';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${fullName}</td>
            <td>${qualification}</td>
            <td>${telecom}</td>
            <td>
                <button class="action-btn edit-btn" data-id="${p.id}">Edit</button>
                <button class="action-btn delete-btn" data-id="${p.id}">Delete</button>
            </td>
        `;
        body.appendChild(row);
    });

    body.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const practitioner = practitioners.find(p => p.id === btn.dataset.id);
            if (practitioner) {
                fillForm(practitioner);
            }
        });
    });

    body.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => handleDelete(btn.dataset.id));
    });
}

function paginationControls() {
    return document.getElementById('pagination-controls');
}

function renderPaginationControls(totalCount) {
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const container = paginationControls();
    container.innerHTML = `
        <span class="pagination-info">Page ${currentPageNumber} of ${totalPages} (${totalCount} total)</span>
        <div class="pagination-buttons">
            <button type="button" id="prev-page-btn" class="secondary-btn" ${prevPageUrl ? '' : 'disabled'}>Previous</button>
            <button type="button" id="next-page-btn" class="secondary-btn" ${nextPageUrl ? '' : 'disabled'}>Next</button>
        </div>
    `;

    document.getElementById('prev-page-btn').addEventListener('click', () => {
        if (prevPageUrl) {
            currentPageNumber -= 1;
            refreshList(prevPageUrl);
        }
    });

    document.getElementById('next-page-btn').addEventListener('click', () => {
        if (nextPageUrl) {
            currentPageNumber += 1;
            refreshList(nextPageUrl);
        }
    });
}

function renderSkeletonRows(rowCount = PAGE_SIZE) {
    const body = tableBody();
    body.innerHTML = '';

    for (let i = 0; i < rowCount; i++) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><span class="skeleton" style="width: ${60 + (i % 3) * 10}%"></span></td>
            <td><span class="skeleton" style="width: ${40 + (i % 4) * 10}%"></span></td>
            <td><span class="skeleton" style="width: ${50 + (i % 2) * 15}%"></span></td>
            <td>
                <span class="action-btn skeleton"></span>
                <span class="action-btn skeleton"></span>
            </td>
        `;
        body.appendChild(row);
    }
}

async function refreshList(url) {
    renderSkeletonRows();
    if (!url) {
        currentPageNumber = 1;
    }
    try {
        const { practitioners, total, nextUrl, prevUrl } = await fetchPractitionerPage(url || firstPageUrl());
        nextPageUrl = nextUrl;
        prevPageUrl = prevUrl;
        renderPractitioners(practitioners);
        renderPaginationControls(total);
    } catch (err) {
        showStatus(err.message, true);
        tableBody().innerHTML = '';
        paginationControls().innerHTML = '';
    }
}

async function handleDelete(id) {
    if (!confirm('Delete this practitioner?')) {
        return;
    }
    try {
        await deletePractitioner(id);
        showStatus('Practitioner deleted.');
        resetForm();
        await refreshList();
    } catch (err) {
        showStatus(err.message, true);
    }
}

async function handleSubmit(event) {
    event.preventDefault();
    clearStatus();

    const id = form()['practitioner-id'].value;
    const practitioner = new Practitioner({
        id,
        name: {
            family: form()['family'].value.trim(),
            given: form()['given'].value.trim()
        },
        qualification: {
            text: form()['qualification'].value.trim()
        },
        telecom: {
            system: form()['telecom-system'].value,
            value: form()['telecom-value'].value.trim()
        }
    });

    try {
        if (id) {
            await updatePractitioner(practitioner);
            showStatus('Practitioner updated.');
        } else {
            await createPractitioner(practitioner);
            showStatus('Practitioner created.');
        }
        resetForm();
        await refreshList();
    } catch (err) {
        showStatus(err.message, true);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    form().addEventListener('submit', handleSubmit);
    document.getElementById('cancel-btn').addEventListener('click', resetForm);
    refreshList();
});
