const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 3000;
const FHIR_BASE = 'https://cdr.pheref.fhirlab.net/fhir';
const root = __dirname;

const send = (response, status, body, contentType = 'application/json') => {
    response.writeHead(status, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Accept, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
    });
    response.end(body);
};

const proxyFhir = (request, response, pathname, search) => {
    const target = new URL(`${FHIR_BASE}${pathname.replace(/^\/fhir/, '')}${search}`);
    const client = https.request(target, {
        method: request.method,
        headers: {
            Accept: request.headers.accept || 'application/fhir+json',
            'Content-Type': request.headers['content-type'] || 'application/fhir+json'
        }
    }, (upstream) => {
        let body = '';
        upstream.setEncoding('utf8');
        upstream.on('data', (chunk) => { body += chunk; });
        upstream.on('end', () => send(response, upstream.statusCode || 502, body, upstream.headers['content-type'] || 'application/fhir+json'));
    });
    client.on('error', (error) => send(response, 502, JSON.stringify({ error: `FHIR proxy error: ${error.message}` })));
    request.pipe(client);
};

const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'OPTIONS') return send(response, 204, '');
    if (url.pathname.startsWith('/fhir/')) return proxyFhir(request, response, url.pathname, url.search);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.join(root, requested);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) return send(response, 404, 'Not found', 'text/plain');
    const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json';
    send(response, 200, fs.readFileSync(filePath), contentType);
});

server.listen(PORT, () => console.log(`e-Referral app: http://localhost:${PORT}/index.html`));
