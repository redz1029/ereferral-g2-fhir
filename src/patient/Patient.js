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
    // PSGC API
    // ==========================================================
    // Third-party static API generated from PSA PSGC data.
    // FHIR still stores the official 10-digit PSGC codes.
    const PSGC_API_BASE = "https://psgc.gitlab.io/api";

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

    async function fetchPSGC(path) {
        const response = await fetch(`${PSGC_API_BASE}${path}`, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`PSGC API returned HTTP ${response.status}`);
        }

        return response.json();
    }


    function getPSGC10DigitCode(item) {
        return String(item.psgc10DigitCode || item.code || "");
    }


    function getPSGC9DigitCode(item) {
        return String(item.code || "");
    }


    function getRegionDisplay(item) {
        const regionName = item.regionName || "";
        const areaName = item.name || "";

        if (regionName && areaName && regionName !== areaName) {
            return `${regionName} (${areaName})`;
        }

        return regionName || areaName || "Unknown Region";
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