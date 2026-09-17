// Controller - Patient Directory (fetch, render, DOM/event wiring)



    // ==========================================================
    // STATE
    // ==========================================================

    let allPatients = [];

    let filteredPatients = [];

    // Current text in the Patient Directory search box.
    let patientSearchTerm = "";

    let currentPage = 1;

    let pageSize = 10;

    let editingPatient = null;
    let isSavingPatient = false;


    // ==========================================================
    // INITIAL LOAD
    // ==========================================================

    document
        .getElementById("btn-patient")
        .addEventListener(
            "click",
            loadPatients
        );


   // ==========================================================
// LOAD PATIENT DIRECTORY
// ==========================================================

async function loadPatients() {

    const content =
        document.getElementById("content");


    content.innerHTML = `

        <div class="card">

            <div class="loading">
                Loading Patient Directory...
            </div>

        </div>

    `;


    try {

        /*
         * FHIR Patient search is paginated.
         *
         * Instead of reading only the first 100 patients,
         * keep following Bundle.link[relation="next"]
         * until there are no more pages.
         */

        let nextUrl =
            `${FHIR_BASE_URL}/Patient?_count=100`;

        const patients = [];


        while (nextUrl) {

            console.log(
                "FHIR Patient Directory:",
                nextUrl
            );


            const response =
                await fetch(
                    nextUrl,
                    {
                        method: "GET",

                        headers: {
                            "Accept":
                                "application/fhir+json"
                        }
                    }
                );


            if (!response.ok) {

                throw new Error(
                    `FHIR Server returned HTTP ${response.status}`
                );

            }


            const bundle =
                await response.json();


            if (
                bundle.resourceType !==
                "Bundle"
            ) {

                throw new Error(
                    "FHIR response is not a Patient Bundle."
                );

            }


            /*
             * Add patients from this page.
             */

            (bundle.entry || [])
                .forEach(
                    entry => {

                        const resource =
                            entry.resource;


                        if (
                            resource?.resourceType ===
                            "Patient"
                        ) {

                            patients.push(
                                resource
                            );

                        }

                    }
                );


            /*
             * Find the next FHIR page.
             *
             * Example:
             *
             * Bundle.link = [
             *   {
             *      relation: "self",
             *      url: "..."
             *   },
             *   {
             *      relation: "next",
             *      url: "..."
             *   }
             * ]
             */

            const nextLink =
                (bundle.link || [])
                    .find(
                        link =>
                            link.relation ===
                            "next"
                    );


            nextUrl =
                nextLink?.url ||
                null;

        }


        /*
         * Replace the directory data with ALL
         * Patient resources retrieved from the
         * paginated FHIR search.
         */

        allPatients =
            patients;


        /*
         * If the directory is loaded again after
         * Add / Update / Delete, preserve the
         * current search text.
         */

        const search =
            patientSearchTerm
                .trim()
                .toLowerCase();


        if (!search) {

            filteredPatients =
                [...allPatients];

        } else {

            filteredPatients =
                allPatients.filter(
                    patient => {

                        const name =
                            getPatientName(
                                patient
                            ).toLowerCase();


                        const identifier =
                            (
                                patient.identifier?.[0]?.value ||
                                ""
                            ).toLowerCase();


                        const gender =
                            (
                                patient.gender ||
                                ""
                            ).toLowerCase();


                        const birthDate =
                            (
                                patient.birthDate ||
                                ""
                            ).toLowerCase();


                        const address =
                            getAddressSummary(
                                patient
                            ).toLowerCase();


                        const fhirId =
                            (
                                patient.id ||
                                ""
                            ).toLowerCase();


                        return (

                            fhirId.includes(search) ||

                            name.includes(search) ||

                            identifier.includes(search) ||

                            gender.includes(search) ||

                            birthDate.includes(search) ||

                            address.includes(search)

                        );

                    }
                );

        }


        currentPage =
            1;


        renderPatientDirectory();


    } catch (error) {

        console.error(
            error
        );


        content.innerHTML = `

            <div class="card">

                <div class="error">

                    <strong>
                        Failed to load Patient Directory
                    </strong>

                    <br><br>

                    ${escapeHtml(
                        error.message
                    )}

                    <br><br>

                    <strong>
                        Endpoint:
                    </strong>

                    <br>

                    <code>
                        ${escapeHtml(
                            `${FHIR_BASE_URL}/Patient`
                        )}
                    </code>

                </div>

            </div>

        `;

    }

}
    // ==========================================================
    // RENDER DIRECTORY
    // ==========================================================

    function renderPatientDirectory() {

        const content =
            document.getElementById("content");


        const total =
            filteredPatients.length;


        const totalPages =
            Math.max(
                1,
                Math.ceil(
                    total / pageSize
                )
            );


        if (
            currentPage >
            totalPages
        ) {

            currentPage =
                totalPages;

        }


        const start =
            (currentPage - 1) *
            pageSize;


        const end =
            Math.min(
                start + pageSize,
                total
            );


        const pagePatients =
            filteredPatients.slice(
                start,
                end
            );


        content.innerHTML = `

            <div class="card">

                <!-- HEADER -->

                <div class="page-header">

                    <div>

                        <h2>
                            Patient Directory
                        </h2>

                        <p>
                            Manage registered patient records,
                            demographics, and identifiers.
                        </p>

                    </div>


                    <button
                        class="btn btn-primary"
                        onclick="openAddPatientModal()">
                        + Add Patient
                    </button>

                </div>


                <!-- STATUS -->

                <div class="status">

                    FHIR Patient resources loaded:
                    <strong>
                        ${allPatients.length}
                    </strong>

                </div>


                <!-- TOOLBAR -->

                <div class="toolbar">

                    <div class="entries-control">

                        <span>
                            Show
                        </span>

                        <select
                            id="pageSizeSelect">

                            <option value="10"
                                ${pageSize === 10 ? "selected" : ""}>
                                10
                            </option>

                            <option value="25"
                                ${pageSize === 25 ? "selected" : ""}>
                                25
                            </option>

                            <option value="50"
                                ${pageSize === 50 ? "selected" : ""}>
                                50
                            </option>

                            <option value="100"
                                ${pageSize === 100 ? "selected" : ""}>
                                100
                            </option>

                        </select>

                        <span>
                            entries
                        </span>

                    </div>


                    <div class="search-box">

                        <label>
                            Search:
                        </label>

                        <input
                            type="text"
                            class="search-input"
                            id="patientSearch"
                            placeholder="Search patient..."
                            value="${escapeHtml(patientSearchTerm)}"
                        >

                    </div>

                </div>


                <!-- TABLE -->

                <div class="table-wrapper">

                    <table>

                        <thead>

                            <tr>

                                <th>
                                    #
                                </th>

                                <th>
                                    FHIR ID
                                </th>

                                <th>
                                    PATIENT NAME
                                </th>

                                <th>
                                    GENDER
                                </th>

                                <th>
                                    BIRTH DATE / AGE
                                </th>

                                <th>
                                    IDENTIFIER
                                </th>

                                <th>
                                    ADDRESS & CONTACT
                                </th>

                                <th>
                                    ACTION
                                </th>

                            </tr>

                        </thead>


                        <tbody id="patientTableBody">

                            ${renderPatientRows(
                                pagePatients,
                                start
                            )}

                        </tbody>

                    </table>

                </div>


                <!-- FOOTER -->

                <div class="table-footer">

                    <div
                        class="showing-info"
                        id="showingInfo">

                        ${getShowingText(
                            start,
                            end,
                            total
                        )}

                    </div>


                    <div
                        class="pagination"
                        id="pagination">

                        ${renderPagination(
                            totalPages
                        )}

                    </div>

                </div>

            </div>

        `;


        // Search

        document
            .getElementById("patientSearch")
            .addEventListener(
                "input",
                handleSearch
            );


        // Page size

        document
            .getElementById("pageSizeSelect")
            .addEventListener(
                "change",
                function () {

                    pageSize =
                        Number(
                            this.value
                        );

                    currentPage =
                        1;

                    renderPatientDirectory();

                }
            );

    }


    // ==========================================================
    // TABLE ROWS
    // ==========================================================

    function renderPatientRows(
        patients,
        startIndex
    ) {

        if (
            patients.length === 0
        ) {

            return `

                <tr>

                    <td
                        colspan="8"
                        class="empty-state">

                        No patients found.

                    </td>

                </tr>

            `;

        }


        return patients
            .map(
                (patient, index) => {

                    const name =
                        getPatientName(
                            patient
                        );


                    const gender =
                        patient.gender ||
                        "unknown";


                    const birthDate =
                        patient.birthDate ||
                        "N/A";


                    const age =
                        calculateAge(
                            patient.birthDate
                        );


                    const identifier =
                        patient.identifier?.[0]?.value ||
                        "N/A";


                    const address =
                        getAddressSummary(
                            patient
                        );


                    const phone =
                        patient.telecom?.find(
                            telecom =>
                                telecom.system ===
                                "phone"
                        )?.value ||
                        "N/A";


                    const genderClass =
                        `gender-${gender}`;


                    return `

                        <tr>

                            <td>
                                ${startIndex + index + 1}
                            </td>


                            <td>

                                <span class="fhir-id">
                                    #${escapeHtml(
                                        patient.id ||
                                        "N/A"
                                    )}
                                </span>

                            </td>


                            <td>

                                <span class="patient-name">
                                    ${escapeHtml(
                                        name
                                    )}
                                </span>

                            </td>


                            <td>

                                <span
                                    class="gender-badge ${genderClass}">

                                    ${escapeHtml(
                                        capitalize(
                                            gender
                                        )
                                    )}

                                </span>

                            </td>


                            <td>

                                <strong>
                                    ${escapeHtml(
                                        birthDate
                                    )}
                                </strong>

                                ${
                                    age !== null
                                        ? `
                                            <span class="sub-text">
                                                (${age} years old)
                                            </span>
                                          `
                                        : ""
                                }

                            </td>


                            <td>

                                <span
                                    class="sub-text"
                                    style="margin-top:0;">

                                    ${escapeHtml(
                                        identifier
                                    )}

                                </span>

                            </td>


                            <td>

                                <span>
                                    ${escapeHtml(
                                        address
                                    )}
                                </span>

                                <span class="sub-text">
                                    ☎ ${escapeHtml(phone)}
                                </span>

                            </td>


                            <td>

                                <div class="action-buttons">

                                    <button
                                        class="btn btn-edit"
                                        onclick="openEditPatient('${escapeJs(
                                            patient.id
                                        )}')">

                                        Edit

                                    </button>


                                    <button
                                        class="btn btn-danger"
                                        onclick="deletePatientById('${escapeJs(
                                            patient.id
                                        )}')">

                                        Delete

                                    </button>

                                </div>

                            </td>

                        </tr>

                    `;

                }
            )
            .join("");

    }


    // ==========================================================
    // SEARCH
    // ==========================================================

    function handleSearch(
        event
    ) {

        // Keep the search text in state so re-renders do not erase it.
        patientSearchTerm = event.target.value;

        const search =
            patientSearchTerm
                .trim()
                .toLowerCase();


        if (!search) {

            filteredPatients =
                [...allPatients];

        } else {

            filteredPatients =
                allPatients.filter(
                    patient => {

                        const name =
                            getPatientName(
                                patient
                            ).toLowerCase();


                        const identifier =
                            (
                                patient.identifier?.[0]?.value ||
                                ""
                            ).toLowerCase();


                        const gender =
                            (
                                patient.gender ||
                                ""
                            ).toLowerCase();


                        const birthDate =
                            (
                                patient.birthDate ||
                                ""
                            ).toLowerCase();


                        const address =
                            getAddressSummary(
                                patient
                            ).toLowerCase();


                        return (

                            name.includes(search) ||

                            identifier.includes(search) ||

                            gender.includes(search) ||

                            birthDate.includes(search) ||

                            address.includes(search)

                        );

                    }
                );

        }


        currentPage =
            1;

        // IMPORTANT:
        // Do NOT call renderPatientDirectory() here.
        // That recreates the <input> while the user is typing,
        // causing focus/cursor loss after the first character.
        // Only update the parts that actually changed.
        updatePatientDirectoryResults();

    }


    function updatePatientDirectoryResults() {

        const total =
            filteredPatients.length;

        const totalPages =
            Math.max(
                1,
                Math.ceil(
                    total / pageSize
                )
            );

        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        const start =
            (currentPage - 1) * pageSize;

        const end =
            Math.min(
                start + pageSize,
                total
            );

        const pagePatients =
            filteredPatients.slice(
                start,
                end
            );

        const tbody =
            document.getElementById(
                "patientTableBody"
            );

        if (tbody) {
            tbody.innerHTML =
                renderPatientRows(
                    pagePatients,
                    start
                );
        }

        const showingInfo =
            document.getElementById(
                "showingInfo"
            );

        if (showingInfo) {
            showingInfo.textContent =
                getShowingText(
                    start,
                    end,
                    total
                );
        }

        const pagination =
            document.getElementById(
                "pagination"
            );

        if (pagination) {
            pagination.innerHTML =
                renderPagination(
                    totalPages
                );
        }

    }


    // ==========================================================
    // PAGINATION
    // ==========================================================

    function renderPagination(
        totalPages
    ) {

        if (
            totalPages <= 1
        ) {

            return "";

        }


        let html = "";


        html += `

            <button
                class="page-btn"
                onclick="goToPage(${currentPage - 1})"
                ${currentPage === 1 ? "disabled" : ""}>

                Previous

            </button>

        `;


        const maxVisible =
            5;


        let startPage =
            Math.max(
                1,
                currentPage -
                Math.floor(
                    maxVisible / 2
                )
            );


        let endPage =
            Math.min(
                totalPages,
                startPage +
                maxVisible -
                1
            );


        if (
            endPage -
            startPage +
            1 <
            maxVisible
        ) {

            startPage =
                Math.max(
                    1,
                    endPage -
                    maxVisible +
                    1
                );

        }


        for (
            let page = startPage;
            page <= endPage;
            page++
        ) {

            html += `

                <button
                    class="page-btn ${
                        page === currentPage
                            ? "active"
                            : ""
                    }"
                    onclick="goToPage(${page})">

                    ${page}

                </button>

            `;

        }


        html += `

            <button
                class="page-btn"
                onclick="goToPage(${currentPage + 1})"
                ${
                    currentPage === totalPages
                        ? "disabled"
                        : ""
                }>

                Next

            </button>

        `;


        return html;

    }


    function goToPage(
        page
    ) {

        const totalPages =
            Math.max(
                1,
                Math.ceil(
                    filteredPatients.length /
                    pageSize
                )
            );


        if (
            page < 1 ||
            page > totalPages
        ) {

            return;

        }


        currentPage =
            page;


        renderPatientDirectory();

    }


    function getShowingText(
        start,
        end,
        total
    ) {

        if (
            total === 0
        ) {

            return "Showing 0 entries";

        }


        return `Showing ${
            start + 1
        } to ${
            end
        } of ${
            total
        } entries`;

    }


    // ==========================================================
    // ADD PATIENT
    // ==========================================================

    async function openAddPatientModal() {

        editingPatient =
            null;


        document.getElementById(
            "modalTitle"
        ).textContent =
            "Add Patient";


        document.getElementById(
            "savePatientBtn"
        ).textContent =
            "Save Patient";


        document.getElementById(
            "editIdSection"
        ).style.display =
            "none";


        document
            .getElementById("patientForm")
            .reset();


        document.getElementById(
            "country"
        ).value =
            "PH";


        initializeRegions();


        document.getElementById(
            "patientModal"
        ).classList.add(
            "active"
        );

    }


    // ==========================================================
    // EDIT PATIENT
    // ==========================================================

    async function openEditPatient(
        patientId
    ) {

        try {

            const response =
                await fetch(
                    `${FHIR_BASE_URL}/Patient/${encodeURIComponent(patientId)}`,
                    {

                        method: "GET",

                        headers: {
                            "Accept":
                                "application/fhir+json"
                        }

                    }
                );


            if (!response.ok) {

                throw new Error(
                    `Unable to load Patient ${patientId}. HTTP ${response.status}`
                );

            }


            const patient =
                await response.json();


            editingPatient =
                patient;


            await fillPatientForm(
                patient
            );


            document.getElementById(
                "modalTitle"
            ).textContent =
                "Edit Patient";


            document.getElementById(
                "savePatientBtn"
            ).textContent =
                "Update Patient";


            document.getElementById(
                "editIdSection"
            ).style.display =
                "block";


            document.getElementById(
                "patientModal"
            ).classList.add(
                "active"
            );


        } catch (error) {

            console.error(
                error
            );


            alert(
                `Failed to load Patient.\n\n${error.message}`
            );

        }

    }


    // ==========================================================
    // FILL EDIT FORM
    // ==========================================================

    async function fillPatientForm(
        patient
    ) {
        document
            .getElementById("patientForm")
            .reset();

        document.getElementById("editPatientId").value = patient.id || "";

        const name =
            patient.name?.find(n => n.use === "official") ||
            patient.name?.[0] ||
            {};

        const given = Array.isArray(name.given) ? name.given : [];

        document.getElementById("firstName").value = given[0] || "";
        document.getElementById("middleName").value = given.slice(1).join(" ");
        document.getElementById("lastName").value = name.family || "";
        document.getElementById("gender").value = patient.gender || "";
        document.getElementById("birthDate").value = patient.birthDate || "";
        document.getElementById("phone").value =
            patient.telecom?.find(t => t.system === "phone")?.value || "";

        const address = patient.address?.[0] || {};

        document.getElementById("addressLine").value =
            address.line?.join(", ") || "";
        document.getElementById("postalCode").value = address.postalCode || "";
        document.getElementById("country").value = address.country || "PH";

        const region = getAddressCoding(address, EXTENSION_URLS.region);
        const province = getAddressCoding(address, EXTENSION_URLS.province);
        const municipality = getAddressCoding(address, EXTENSION_URLS.municipality);
        const barangay = getAddressCoding(address, EXTENSION_URLS.barangay);

        await initializeRegions();

        if (region?.code) {
            const regionSelect = document.getElementById("region");
            regionSelect.value = region.code;
            await loadProvinces(region.code);
        }

        if (province?.code) {
            const provinceSelect = document.getElementById("province");
            provinceSelect.value = province.code;
            await loadMunicipalities(province.code);
        }

        if (municipality?.code) {
            const municipalitySelect = document.getElementById("municipality");
            municipalitySelect.value = municipality.code;
            await loadBarangays(municipality.code);
        }

        if (barangay?.code) {
            document.getElementById("barangay").value = barangay.code;
        }
    }

    // ==========================================================
    // SAVE / UPDATE PATIENT
    // ==========================================================

    document
        .getElementById("patientForm")
        .addEventListener(
            "submit",
            savePatient
        );


    async function savePatient(
        event
    ) {
        event.preventDefault();

        // Hard guard against double-click / duplicate POST.
        if (isSavingPatient) {
            return;
        }

        const button = document.getElementById("savePatientBtn");
        const isEditing = Boolean(editingPatient?.id);

        isSavingPatient = true;
        button.disabled = true;
        button.textContent = isEditing ? "Updating..." : "Saving...";

        try {
            const patient = buildPatientResource();

            console.log("FHIR payload:", patient);

            const url = isEditing
                ? `${FHIR_BASE_URL}/Patient/${encodeURIComponent(editingPatient.id)}`
                : `${FHIR_BASE_URL}/Patient`;

            const response = await fetch(url, {
                method: isEditing ? "PUT" : "POST",
                headers: {
                    "Content-Type": "application/fhir+json",
                    "Accept": "application/fhir+json"
                },
                body: JSON.stringify(patient)
            });

            const responseText = await response.text();

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}\n${responseText}`);
            }

            let savedResource = null;
            try {
                savedResource = responseText ? JSON.parse(responseText) : null;
            } catch (_) {
                // Some FHIR servers may return an empty body for successful writes.
            }

            const returnedId = savedResource?.id || patient.id || "";

            closePatientModal();

            alert(
                isEditing
                    ? `Patient updated successfully.${returnedId ? `\n\nFHIR ID: ${returnedId}` : ""}`
                    : `Patient created successfully.${returnedId ? `\n\nFHIR ID: ${returnedId}` : ""}`
            );

            await loadPatients();

        } catch (error) {
            console.error(error);
            alert(`Failed to ${isEditing ? "update" : "create"} Patient.\n\n${error.message}`);
        } finally {
            isSavingPatient = false;
            button.disabled = false;
            button.textContent = isEditing ? "Update Patient" : "Save Patient";
        }
    }

    // ==========================================================
    // BUILD FHIR PATIENT
    // ==========================================================

    function buildPatientResource() {

        const firstName =
            document.getElementById(
                "firstName"
            ).value.trim();


        const middleName =
            document.getElementById(
                "middleName"
            ).value.trim();


        const lastName =
            document.getElementById(
                "lastName"
            ).value.trim();


        const gender =
            document.getElementById(
                "gender"
            ).value;


        const birthDate =
            document.getElementById(
                "birthDate"
            ).value;


        const phone =
            document.getElementById(
                "phone"
            ).value.trim();


        const addressLine =
            document.getElementById(
                "addressLine"
            ).value.trim();


        const postalCode =
            document.getElementById(
                "postalCode"
            ).value.trim();


        const country =
            document.getElementById(
                "country"
            ).value.trim()
            ||
            "PH";


        const region =
            getSelectedOptionData(
                document.getElementById(
                    "region"
                )
            );


        const province =
            getSelectedOptionData(
                document.getElementById(
                    "province"
                )
            );


        const municipality =
            getSelectedOptionData(
                document.getElementById(
                    "municipality"
                )
            );


        const barangay =
            getSelectedOptionData(
                document.getElementById(
                    "barangay"
                )
            );


        const patient = {

            resourceType:
                "Patient",

            active:
                true,

            name: [

                {

                    use:
                        "official",

                    family:
                        lastName,

                    given:
                        [
                            firstName,
                            ...(middleName
                                ? [middleName]
                                : [])
                        ]

                }

            ],

            gender:
                gender,

            telecom:
                phone
                    ? [
                        {
                            system: "phone",
                            value: phone,
                            use: "mobile"
                        }
                    ]
                    : [],

            address: [

                {

                    use:
                        "home",

                    extension: [

                        createCodingExtension(
                            EXTENSION_URLS.region,
                            region
                        ),

                        createCodingExtension(
                            EXTENSION_URLS.province,
                            province
                        ),

                        createCodingExtension(
                            EXTENSION_URLS.municipality,
                            municipality
                        ),

                        createCodingExtension(
                            EXTENSION_URLS.barangay,
                            barangay
                        )

                    ].filter(Boolean),

                    line:
                        addressLine
                            ? [addressLine]
                            : [],

                    postalCode:
                        postalCode,

                    country:
                        country

                }

            ]

        };


        if (birthDate) {

            patient.birthDate =
                birthDate;

        }


        // ======================================================
        // CREATE
        // ======================================================

        if (
            !editingPatient
        ) {

            patient.identifier = [

                {

                    system:
                        "https://r12-connectathon.example/identifier/patient",

                    value:
                        `GROUP2-PATIENT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

                }

            ];

        }


        // ======================================================
        // UPDATE
        //
        // Preserve ID, identifier and meta from existing
        // FHIR resource.
        // ======================================================

        else {

            patient.id =
                editingPatient.id;


            if (
                editingPatient.meta
            ) {

                patient.meta =
                    editingPatient.meta;

            }


            if (
                editingPatient.identifier
            ) {

                patient.identifier =
                    editingPatient.identifier;

            }


            /*
             * Preserve profile from meta.
             * meta is already copied above.
             */

        }


        removeUndefined(
            patient
        );


        return patient;

    }


    // ==========================================================
    // DELETE
    // ==========================================================

    async function deletePatientById(
        patientId
    ) {

        const patient =
            allPatients.find(
                p =>
                    String(p.id) ===
                    String(patientId)
            );


        const name =
            patient
                ? getPatientName(patient)
                : patientId;


        const confirmed =
            confirm(
                `Are you sure you want to DELETE this Patient?\n\n${name}\nFHIR ID: ${patientId}\n\nThis will send DELETE to the FHIR server.`
            );


        if (!confirmed) {

            return;

        }


        try {

            const response =
                await fetch(
                    `${FHIR_BASE_URL}/Patient/${encodeURIComponent(patientId)}`,
                    {

                        method: "DELETE",

                        headers: {

                            "Accept":
                                "application/fhir+json"

                        }

                    }
                );


            const responseText =
                await response.text();


            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}\n${responseText}`
                );

            }


            alert(
                "Patient deleted successfully."
            );


            await loadPatients();


        } catch (error) {

            console.error(
                error
            );


            alert(
                `Failed to delete Patient.\n\n${error.message}`
            );

        }

    }


    async function initializeRegions() {
        const region = document.getElementById("region");
        const province = document.getElementById("province");
        const municipality = document.getElementById("municipality");
        const barangay = document.getElementById("barangay");

        resetSelect(region, "Select Region");
        resetSelect(province, "Select Province");
        resetSelect(municipality, "Select Municipality / City");
        resetSelect(barangay, "Select Barangay");

        province.disabled = true;
        municipality.disabled = true;
        barangay.disabled = true;

        try {
            if (!PSGC_CACHE.regions) {
                PSGC_CACHE.regions = await fetchPSGC("/regions/");
            }

            (PSGC_CACHE.regions || []).forEach(item => {
                addOption(
                    region,
                    getPSGC10DigitCode(item),
                    getRegionDisplay(item),
                    getPSGC9DigitCode(item)
                );
            });

        } catch (error) {
            console.error("Failed to load PSGC regions:", error);
            addOption(region, "", "Unable to load regions");
            region.disabled = true;
            alert(`Failed to load PSGC regions.\n\n${error.message}`);
        }
    }


    async function loadProvinces(regionCode10) {
        const region = document.getElementById("region");
        const province = document.getElementById("province");
        const municipality = document.getElementById("municipality");
        const barangay = document.getElementById("barangay");

        resetSelect(province, "Select Province");
        resetSelect(municipality, "Select Municipality / City");
        resetSelect(barangay, "Select Barangay");

        municipality.disabled = true;
        barangay.disabled = true;

        if (!regionCode10) {
            province.disabled = true;
            return;
        }

        try {
            const regionOption = region.options[region.selectedIndex];
            const regionCode9 = regionOption?.dataset.parentCode;

            if (!regionCode9) {
                province.disabled = true;
                return;
            }

            let list = PSGC_CACHE.provinces.get(regionCode9);

            if (!list) {
                list = await fetchPSGC(`/regions/${encodeURIComponent(regionCode9)}/provinces/`);
                PSGC_CACHE.provinces.set(regionCode9, list || []);
            }

            (list || []).forEach(item => {
                addOption(
                    province,
                    getPSGC10DigitCode(item),
                    item.name || "Unknown Province",
                    getPSGC9DigitCode(item)
                );
            });

            province.disabled = false;

        } catch (error) {
            console.error("Failed to load PSGC provinces:", error);
            province.disabled = true;
            alert(`Failed to load provinces.\n\n${error.message}`);
        }
    }


    async function loadMunicipalities(provinceCode10) {
        const province = document.getElementById("province");
        const municipality = document.getElementById("municipality");
        const barangay = document.getElementById("barangay");

        resetSelect(municipality, "Select Municipality / City");
        resetSelect(barangay, "Select Barangay");
        barangay.disabled = true;

        if (!provinceCode10) {
            municipality.disabled = true;
            return;
        }

        try {
            const provinceOption = province.options[province.selectedIndex];
            const provinceCode9 = provinceOption?.dataset.parentCode;

            if (!provinceCode9) {
                municipality.disabled = true;
                return;
            }

            let list = PSGC_CACHE.municipalities.get(provinceCode9);

            if (!list) {
                list = await fetchPSGC(`/provinces/${encodeURIComponent(provinceCode9)}/cities-municipalities/`);
                PSGC_CACHE.municipalities.set(provinceCode9, list || []);
            }

            (list || []).forEach(item => {
                addOption(
                    municipality,
                    getPSGC10DigitCode(item),
                    item.name || "Unknown Municipality / City",
                    getPSGC9DigitCode(item)
                );
            });

            municipality.disabled = false;

        } catch (error) {
            console.error("Failed to load PSGC municipalities/cities:", error);
            municipality.disabled = true;
            alert(`Failed to load municipalities/cities.\n\n${error.message}`);
        }
    }


    async function loadBarangays(municipalityCode10) {
        const municipality = document.getElementById("municipality");
        const barangay = document.getElementById("barangay");

        resetSelect(barangay, "Select Barangay");

        if (!municipalityCode10) {
            barangay.disabled = true;
            return;
        }

        try {
            const municipalityOption = municipality.options[municipality.selectedIndex];
            const municipalityCode9 = municipalityOption?.dataset.parentCode;

            if (!municipalityCode9) {
                barangay.disabled = true;
                return;
            }

            let list = PSGC_CACHE.barangays.get(municipalityCode9);

            if (!list) {
                list = await fetchPSGC(`/cities-municipalities/${encodeURIComponent(municipalityCode9)}/barangays/`);
                PSGC_CACHE.barangays.set(municipalityCode9, list || []);
            }

            (list || []).forEach(item => {
                addOption(
                    barangay,
                    getPSGC10DigitCode(item),
                    item.name || "Unknown Barangay",
                    getPSGC9DigitCode(item)
                );
            });

            barangay.disabled = false;

        } catch (error) {
            console.error("Failed to load PSGC barangays:", error);
            barangay.disabled = true;
            alert(`Failed to load barangays.\n\n${error.message}`);
        }
    }


    document
        .getElementById("region")
        .addEventListener("change", async function () {
            await loadProvinces(this.value);
        });


    document
        .getElementById("province")
        .addEventListener("change", async function () {
            await loadMunicipalities(this.value);
        });


    document
        .getElementById("municipality")
        .addEventListener("change", async function () {
            await loadBarangays(this.value);
        });


    function resetSelect(select, placeholder) {
        select.innerHTML = `<option value="">${placeholder}</option>`;
    }


    function addOption(select, value, text, parentCode = "") {
        const option = document.createElement("option");

        option.value = value;
        option.textContent = text;
        option.dataset.display = text;
        option.dataset.parentCode = parentCode;

        select.appendChild(option);
    }


    function getSelectedOptionData(select) {
        if (!select || !select.value) {
            return null;
        }

        const option = select.options[select.selectedIndex];

        return {
            code: option.value,
            display: option.dataset.display || option.textContent
        };
    }


    // ==========================================================
    // MODAL CLOSE
    // ==========================================================

    function closePatientModal() {

        document
            .getElementById(
                "patientModal"
            )
            .classList.remove(
                "active"
            );


        editingPatient =
            null;

    }


    document
        .getElementById("closeModal")
        .addEventListener(
            "click",
            closePatientModal
        );


    document
        .getElementById("cancelModal")
        .addEventListener(
            "click",
            closePatientModal
        );


    document
        .getElementById("patientModal")
        .addEventListener(
            "click",
            function (event) {

                if (
                    event.target ===
                    this
                ) {

                    closePatientModal();

                }

            }
        );


    console.log(
        "e-Referral Group 2 FHIR loaded."
    );

    console.log(
        "FHIR Base:",
        FHIR_BASE_URL
    );

