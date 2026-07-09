// server.js
require('dotenv').config({ quiet: true });
const express = require('express');
const crypto = require('crypto');
const { runAutomation } = require('./automation');
const { decryptPassword } = require('./crypto-util');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const AUTOMATION_TRIGGER_SECRET = process.env.AUTOMATION_TRIGGER_SECRET;
const STORE_DATA_BASE_URL = process.env.STORE_DATA_BASE_URL;
const STORE_DATA_AUTH_TOKEN = process.env.STORE_DATA_AUTH_TOKEN;

/**
 * Timing-safe comparison of the caller's "Authorization: Bearer <secret>"
 * header against AUTOMATION_TRIGGER_SECRET, so this service can't be
 * triggered by anyone who doesn't know the shared secret.
 */
function isAuthorizedTrigger(req) {
    if (!AUTOMATION_TRIGGER_SECRET) return false;

    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return false;

    const provided = Buffer.from(token);
    const expected = Buffer.from(AUTOMATION_TRIGGER_SECRET);
    if (provided.length !== expected.length) return false;

    return crypto.timingSafeEqual(provided, expected);
}

/**
 * POST the scraped, structured gas bills to the backend's store-data endpoint.
 */
async function postBillsToStoreData(bills) {
    if (!STORE_DATA_BASE_URL || !STORE_DATA_AUTH_TOKEN) {
        throw new Error('STORE_DATA_BASE_URL and STORE_DATA_AUTH_TOKEN must be set in the environment');
    }

    const url = `${STORE_DATA_BASE_URL.replace(/\/+$/, '')}/api/store-data`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${STORE_DATA_AUTH_TOKEN}`
        },
        body: JSON.stringify({ utilityType: 'gas', bills })
    });

    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
        throw new Error(`store-data endpoint responded ${res.status}: ${bodyText}`);
    }

    console.log(`Posted ${bills.length} bill(s) to ${url} (status ${res.status})`);
    return bodyText;
}

app.post('/run-automation', async (req, res) => {
    if (!isAuthorizedTrigger(req)) {
        return res.status(401).json({ error: 'Missing or invalid Authorization bearer token' });
    }

    const { username, password, dob } = req.body || {};

    if (!username || !password || !dob || !dob.year || !dob.month || !dob.day) {
        return res.status(400).json({
            error: 'Request must include username, password (encrypted), and dob: { year, month, day }'
        });
    }

    let plainPassword;
    try {
        plainPassword = decryptPassword(password);
    } catch (err) {
        return res.status(400).json({ error: `Failed to decrypt password: ${err.message}` });
    }

    const jobId = crypto.randomUUID();

    // Respond immediately; the automation runs in the background since it can take a while.
    res.status(202).json({ jobId, status: 'accepted' });

    runAutomation({
        username,
        password: plainPassword,
        birthYear: dob.year,
        birthMonth: dob.month,
        birthDay: dob.day,
        headless: true
    })
        .then(async ({ bills, rawText }) => {
            console.log(`Job ${jobId} scraped ${bills.length} bill(s).`);
            console.log(rawText);

            if (bills.length === 0) {
                console.warn(`Job ${jobId}: no bills parsed, skipping store-data submission.`);
                return;
            }

            try {
                await postBillsToStoreData(bills);
            } catch (err) {
                console.error(`Job ${jobId}: failed to submit bills to store-data endpoint:`, err.message);
            }
        })
        .catch((err) => {
            console.error(`Automation failed for job ${jobId}:`, err);
        });
});

app.listen(PORT, () => {
    console.log(`Greenify automation microservice listening on port ${PORT}`);
});
