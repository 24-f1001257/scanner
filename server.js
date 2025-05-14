const http = require('http');
const url = require('url');
const open = require('open');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
let userState = {};

// Use environment variables for sensitive data
const CLIENT_ID = process.env.CLIENT_ID || '1013708675568-1nav806sg6c94vvppsm82jfqod0iou26.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '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';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://sgscanner-hgg8huawdagphzbx.centralindia-01.azurewebsites.net/oauth2callback';

const servePage = (res, pageName) => {
    fs.readFile(path.join(__dirname, 'pages', pageName), (err, data) => {
        if (err) {
            res.writeHead(500);
            return res.end('Error loading page');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
};

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/') {
        servePage(res, 'login.html');
    }

    else if (pathname === '/login') {
        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets',
            access_type: 'offline',
            prompt: 'consent',
        });
        res.writeHead(302, { Location: authUrl });
        res.end();
    }

    else if (pathname === '/oauth2callback') {
        const code = parsedUrl.query.code;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: querystring.stringify({
                code,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
            }),
        });

        const tokenData = await tokenRes.json();
        userState = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
        };

        res.writeHead(302, { Location: '/select' });
        res.end();
    }

    else if (pathname === '/select') {
        if (!userState.accessToken) {
            res.writeHead(302, { Location: '/' });
            return res.end();
        }
        servePage(res, 'select.html');
    }

    else if (pathname === '/scanner') {
        if (!userState.accessToken) {
            res.writeHead(302, { Location: '/' });
            return res.end();
        }
        servePage(res, 'scanner.html');
    }

    else if (pathname === '/spreadsheets') {
        if (!userState.accessToken) {
            res.writeHead(401);
            return res.end('Not authorized');
        }

        const driveRes = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType="application/vnd.google-apps.spreadsheet"&fields=files(id,name)', {
            headers: { Authorization: `Bearer ${userState.accessToken}` },
        });

        const driveData = await driveRes.json();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(driveData));
    }

    else if (pathname === '/sheets') {
        const spreadsheetId = parsedUrl.query.spreadsheetId;
        if (!spreadsheetId || !userState.accessToken) {
            res.writeHead(400);
            return res.end('Missing spreadsheet ID or access token');
        }

        const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
            headers: { Authorization: `Bearer ${userState.accessToken}` },
        });

        const sheetData = await sheetRes.json();
        const sheets = (sheetData.sheets || []).map(s => ({
            title: s.properties.title
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sheets }));
    }
    else if (parsedUrl.pathname === '/writeData') {
        const { spreadsheetId, sheetName, data, customText } = parsedUrl.query;

        if (!spreadsheetId || !sheetName || !data || !customText || !userState.accessToken) {
            res.writeHead(400);
            return res.end('Missing parameters or access token');
        }
        const isoTrimmed = new Date().toISOString().split('.')[0] + 'Z';

        // Make the request to Google Sheets API to append the data
        const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:A1:append?valueInputOption=RAW`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${userState.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                values: [[isoTrimmed, data, customText]], // Append both custom text and QR code data
            }),
        });

        if (appendRes.ok) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false }));
        }
    }
    else if (pathname.startsWith('/public/')) {
        const filePath = path.join(__dirname, pathname);
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                return res.end('File not found');
            }

            // Determine content type based on file extension
            let contentType = 'application/octet-stream';
            if (pathname.endsWith('.mp3')) contentType = 'audio/mpeg';
            else if (pathname.endsWith('.ogg')) contentType = 'audio/ogg';

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }

    else {
        res.writeHead(404);
        res.end('Not found');
    }
});
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
