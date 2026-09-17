// Domain data & FHIR mapping helpers - Patient

    // ==========================================================
    // CONFIGURATION
    // ==========================================================

    const FHIR_BASE_URL =
        "https://cdr.pheref.fhirlab.net/fhir";


    const PSGC_SYSTEM =
        "https://psa.gov.ph/classification/psgc";


    const EXTENSION_URLS = {

        region:
            "https://fhir.doh.gov.ph/phcore/StructureDefinition/region",

        province:
            "https://fhir.doh.gov.ph/phcore/StructureDefinition/province",

        municipality:
            "https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality",

        barangay:
            "https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay"

    };


    // ==========================================================
    // PSGC FHIR TERMINOLOGY SERVER
    // ==========================================================
    // PSGC hierarchy is served by a real FHIR terminology server
    // (Ontoserver). The system URL has two versions loaded there:
    // "1Q-2026" is the complete, 43,769-concept nationwide dataset,
    // but the CDR this app saves Patients to validates the region/
    // province/municipality/barangay codings against "2Q-2026"
    // ("PSGCRegion12Mini") regardless of what version is sent in
    // the Coding - confirmed by testing that a code only present
    // in 1Q-2026 gets rejected as "Unknown code" even when the
    // Coding explicitly declared version 1Q-2026. That fragment
    // only contains Region XII (SOCCSKSARGEN) - matching this
    // project's "r12-connectathon" patient identifier scheme - with
    // its full province/municipality tree but only 1-2 sample
    // barangays per municipality. So every PSGC call here must use
    // "2Q-2026", or saves fail with an "Unknown code" error.
    const PSGC_TX_BASE_URL = "https://tx.fhirlab.net/fhir";
    const PSGC_SYSTEM_VERSION = "2Q-2026";
    // 2Q-2026 has no root/all-regions concept - Region XII is the
    // only region it contains, so it's used directly as the sole
    // seed for the Region dropdown instead of enumerating children
    // of a root code.
    const PSGC_REGION_CODE = "1200000000";

    const PSGC_CACHE = {
        regions: null,
        provinces: new Map(),
        municipalities: new Map(),
        barangays: new Map()
    };


    // ==========================================================
    // CREATE PSGC EXTENSION
    // ==========================================================

    function createCodingExtension(
        url,
        item
    ) {

        if (
            !item ||
            !item.code
        ) {

            return null;

        }


        return {

            url:
                url,

            valueCoding: {

                system:
                    PSGC_SYSTEM,

                version:
                    PSGC_SYSTEM_VERSION,

                code:
                    item.code,

                display:
                    item.display

            }

        };

    }


    // ==========================================================
    // PSGC DROPDOWNS
    // ==========================================================

    async function lookupPsgcChildren(code) {
        const url =
            `${PSGC_TX_BASE_URL}/CodeSystem/$lookup` +
            `?system=${encodeURIComponent(PSGC_SYSTEM)}` +
            `&version=${encodeURIComponent(PSGC_SYSTEM_VERSION)}` +
            `&code=${encodeURIComponent(code)}` +
            `&property=child`;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/fhir+json"
            }
        });

        if (!response.ok) {
            throw new Error(`PSGC terminology server returned HTTP ${response.status}`);
        }

        const parameters = await response.json();

        return (parameters.parameter || [])
            .filter(param => param.name === "property")
            .map(param => (param.part || []).find(part => part.name === "value"))
            .filter(Boolean)
            .map(part => part.valueCode)
            .filter(Boolean);
    }


    async function resolvePsgcDisplays(codes) {
        const displays = new Map();

        if (codes.length === 0) {
            return displays;
        }

        const body = {
            resourceType: "Parameters",
            parameter: [
                { name: "url", valueUri: PSGC_SYSTEM },
                ...codes.map(code => ({
                    name: "validation",
                    part: [{
                        name: "coding",
                        valueCoding: {
                            system: PSGC_SYSTEM,
                            version: PSGC_SYSTEM_VERSION,
                            code
                        }
                    }]
                }))
            ]
        };

        const response = await fetch(`${PSGC_TX_BASE_URL}/CodeSystem/$batch-validate-code`, {
            method: "POST",
            headers: {
                "Content-Type": "application/fhir+json",
                "Accept": "application/fhir+json"
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`PSGC terminology server returned HTTP ${response.status}`);
        }

        const parameters = await response.json();

        (parameters.parameter || [])
            .filter(param => param.name === "validation" && param.resource)
            .forEach(param => {
                const parts = param.resource.parameter || [];
                const get = name => parts.find(part => part.name === name);

                const code = get("code")?.valueCode;
                const result = get("result")?.valueBoolean;
                const display = get("display")?.valueString;

                if (code) {
                    displays.set(code, result && display ? display : code);
                }
            });

        return displays;
    }


    async function fetchPsgcChildren(parentCode) {
        const childCodes = await lookupPsgcChildren(parentCode);
        const displays = await resolvePsgcDisplays(childCodes);

        return childCodes
            .map(code => ({
                code,
                display: displays.get(code) || code
            }))
            .sort((a, b) => a.display.localeCompare(b.display));
    }


    async function fetchPsgcConcept(code) {
        const displays = await resolvePsgcDisplays([code]);

        return {
            code,
            display: displays.get(code) || code
        };
    }

    // ==========================================================
    // ADDRESS SUMMARY
    // ==========================================================

    function getAddressSummary(
        patient
    ) {

        const address =
            patient.address?.[0];


        if (!address) {

            return "N/A";

        }


        const barangay =
            getAddressCoding(
                address,
                EXTENSION_URLS.barangay
            );


        const municipality =
            getAddressCoding(
                address,
                EXTENSION_URLS.municipality
            );


        const province =
            getAddressCoding(
                address,
                EXTENSION_URLS.province
            );


        const region =
            getAddressCoding(
                address,
                EXTENSION_URLS.region
            );


        const parts = [];


        if (
            address.line?.length
        ) {

            parts.push(
                address.line.join(", ")
            );

        }


        if (
            barangay?.display
        ) {

            parts.push(
                barangay.display
            );

        }


        if (
            municipality?.display
        ) {

            parts.push(
                municipality.display
            );

        }


        if (
            province?.display
        ) {

            parts.push(
                province.display
            );

        }


        if (
            region?.display
        ) {

            parts.push(
                region.display
            );

        }


        if (
            parts.length === 0 &&
            address.country
        ) {

            parts.push(
                address.country
            );

        }


        return parts.join(", ") ||
            "N/A";

    }


    function getAddressCoding(
        address,
        url
    ) {

        return address
            ?.extension
            ?.find(
                extension =>
                    extension.url === url
            )
            ?.valueCoding ||
            null;

    }


    // ==========================================================
    // PATIENT NAME
    // ==========================================================

    function getPatientName(
        patient
    ) {

        const name =
            patient.name?.find(
                n =>
                    n.use === "official"
            )
            ||
            patient.name?.[0]
            ||
            {};


        const given =
            Array.isArray(name.given)
                ? name.given.join(" ")
                : "";


        return [
            given,
            name.family || ""
        ]
            .filter(Boolean)
            .join(" ")
            ||
            "Unnamed Patient";

    }


    // ==========================================================
    // AGE
    // ==========================================================

    function calculateAge(
        birthDate
    ) {

        if (!birthDate) {

            return null;

        }


        const birth =
            new Date(
                `${birthDate}T00:00:00`
            );


        if (
            Number.isNaN(
                birth.getTime()
            )
        ) {

            return null;

        }


        const today =
            new Date();


        let age =
            today.getFullYear() -
            birth.getFullYear();


        const month =
            today.getMonth() -
            birth.getMonth();


        if (
            month < 0 ||
            (
                month === 0 &&
                today.getDate() <
                birth.getDate()
            )
        ) {

            age--;

        }


        return age;

    }


    // ==========================================================
    // UTILITY
    // ==========================================================

    function capitalize(
        value
    ) {

        if (!value) {

            return "";

        }


        return (
            value.charAt(0).toUpperCase() +
            value.slice(1)
        );

    }


    function removeUndefined(
        object
    ) {

        Object.keys(
            object
        ).forEach(
            key => {

                if (
                    object[key] ===
                    undefined
                ) {

                    delete object[key];

                }

                else if (
                    Array.isArray(
                        object[key]
                    )
                ) {

                    object[key] =
                        object[key].filter(
                            item =>
                                item !==
                                undefined
                        );


                    object[key].forEach(
                        item => {

                            if (
                                item &&
                                typeof item ===
                                "object"
                            ) {

                                removeUndefined(
                                    item
                                );

                            }

                        }
                    );

                }

                else if (
                    object[key] &&
                    typeof object[key] ===
                    "object"
                ) {

                    removeUndefined(
                        object[key]
                    );

                }

            }
        );

    }


    function escapeHtml(
        value
    ) {

        return String(
            value ?? ""
        )

            .replace(
                /&/g,
                "&amp;"
            )

            .replace(
                /</g,
                "&lt;"
            )

            .replace(
                />/g,
                "&gt;"
            )

            .replace(
                /"/g,
                "&quot;"
            )

            .replace(
                /'/g,
                "&#039;"
            );

    }


    function escapeJs(
        value
    ) {

        return String(
            value ?? ""
        )
            .replace(
                /\\/g,
                "\\\\"
            )
            .replace(
                /'/g,
                "\\'"
            );

    }