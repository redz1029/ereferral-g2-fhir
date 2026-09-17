/**
 * Shared FHIR helpers for the home page Network Overview dashboard.
 * Scoped to the dashboard only — other modules keep their own FHIR_BASE
 * constants and fetch helpers, so this file does not change their behavior.
 */

const DASHBOARD_FHIR_SERVER = 'https://cdr.pheref.fhirlab.net/fhir';
const DASHBOARD_FETCH_TIMEOUT_MS = 6000;

/**
 * Fetch with an AbortController-based timeout.
 */
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = DASHBOARD_FETCH_TIMEOUT_MS } = options;
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
 * Cheap FHIR count via _summary=count. queryParams is an optional
 * "key=value&key2=value2" string of extra search parameters.
 */
async function fetchSummaryCount(resourceType, queryParams = '', serverUrl = DASHBOARD_FHIR_SERVER) {
    const params = queryParams ? `${queryParams}&_summary=count` : '_summary=count';
    const url = `${serverUrl}/${resourceType}?${params}`;
    const response = await fetchWithTimeout(url, {
        headers: { 'Accept': 'application/fhir+json, application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return typeof data.total === 'number' ? data.total : 0;
}

/**
 * Generic FHIR pagination fetcher: fetches all pages of a resource type
 * (capped at 2000 entries), following Bundle.link[relation=next].
 */
async function fetchAllFhirResources(resourceType, serverUrl = DASHBOARD_FHIR_SERVER, queryParams = '_count=100') {
    let allEntries = [];
    let nextUrl = `${serverUrl}/${resourceType}?${queryParams}`;

    while (nextUrl && allEntries.length < 2000) {
        const response = await fetchWithTimeout(nextUrl, {
            headers: { 'Accept': 'application/fhir+json, application/json' }
        });

        if (!response.ok) {
            if (allEntries.length > 0) break;
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const entries = data.entry || [];
        if (entries.length === 0) break;
        allEntries = allEntries.concat(entries);

        const nextLink = (data.link || []).find(l => l.relation === 'next');
        if (nextLink && nextLink.url && nextLink.url !== nextUrl) {
            nextUrl = nextLink.url;
        } else {
            nextUrl = null;
        }
    }

    return allEntries;
}

/**
 * Fetch the N most recently updated resources of a given type.
 */
async function fetchRecentResources(resourceType, count = 5, serverUrl = DASHBOARD_FHIR_SERVER) {
    const url = `${serverUrl}/${resourceType}?_sort=-_lastUpdated&_count=${count}`;
    const response = await fetchWithTimeout(url, {
        headers: { 'Accept': 'application/fhir+json, application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return (data.entry || []).map(e => e.resource).filter(Boolean);
}
