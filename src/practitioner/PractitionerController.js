// Controller - Practitioner CRUD
const FHIR_BASE = 'https://cdr.pheref.fhirlab.net/fhir';

async function listPractitioners() {
    const response = await fetch(`${FHIR_BASE}/Practitioner?_sort=-_lastUpdated&_count=50`);
    if (!response.ok) {
        throw new Error(`Failed to load practitioners (${response.status})`);
    }
    const bundle = await response.json();
    return (bundle.entry || []).map(entry => Practitioner.fromFhirJson(entry.resource));
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

function renderSkeletonRows(rowCount = 5) {
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

async function refreshList() {
    renderSkeletonRows();
    try {
        const practitioners = await listPractitioners();
        renderPractitioners(practitioners);
    } catch (err) {
        showStatus(err.message, true);
        tableBody().innerHTML = '';
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
