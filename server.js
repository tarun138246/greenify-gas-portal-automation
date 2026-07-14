// server.js
require('dotenv').config({ quiet: true });
const express = require('express');
const crypto = require('crypto');
const { runAutomation } = require('./automation');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const AUTOMATION_TRIGGER_SECRET = process.env.AUTOMATION_TRIGGER_SECRET;
const STORE_DATA_BASE_URL = process.env.STORE_DATA_BASE_URL;

const AUTOMATION_CONCURRENCY = parseInt(process.env.AUTOMATION_CONCURRENCY || '1', 10);
let activeRuns = 0;
const queue = [];

function runNext() {
    if (activeRuns >= AUTOMATION_CONCURRENCY || queue.length === 0) return;
    const job = queue.shift();
    activeRuns++;
    job().finally(() => {
        activeRuns--;
        runNext();
    });
}

function enqueueAutomation(job) {
    queue.push(job);
    console.log(`Job queued. Position: ${queue.length}, active runs: ${activeRuns}`);
    runNext();
}

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
 * Post scraped bills (gas and electricity) to the backend's store-data endpoint.
 * @param {string} storeDataToken - per-run JWT from the trigger request
 * @param {Array} gasBills - array of parsed gas bill objects
 * @param {Array} electricityBills - array of parsed electricity bill objects
 * @param {boolean} maintenance - whether the utility site was under maintenance
 */
async function postBillsToStoreData(storeDataToken, gasBills, electricityBills, maintenance = false) {
    if (!STORE_DATA_BASE_URL) {
        throw new Error('STORE_DATA_BASE_URL must be set in the environment');
    }

    const url = `${STORE_DATA_BASE_URL.replace(/\/+$/, '')}/api/store-data`;

    const payload = {
        gasBills,
        electricityBills,
        maintenance
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${storeDataToken}`
        },
        body: JSON.stringify(payload)
    });

    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
        throw new Error(`store-data endpoint responded ${res.status}: ${bodyText}`);
    }

    console.log(
        `Posted to ${url} (status ${res.status}): ` +
        `maintenance=${maintenance}, gas=${gasBills.length}, electricity=${electricityBills.length}`
    );
    return bodyText;
}

app.post('/run-automation', async (req, res) => {
    if (!isAuthorizedTrigger(req)) {
        return res.status(401).json({ error: 'Missing or invalid Authorization bearer token' });
    }

    const { username, password, dob, storeDataToken, userId } = req.body || {};

    if (!username || !password || !dob || !dob.year || !dob.month || !dob.day) {
        return res.status(400).json({
            error: 'Request must include username, password, and dob: { year, month, day }'
        });
    }
    if (!storeDataToken) {
        return res.status(400).json({ error: 'Request must include storeDataToken' });
    }

    const jobId = crypto.randomUUID();
    const logLabel = userId ? `${jobId} (user ${userId})` : jobId;

    // Respond immediately; the automation runs in the background.
    res.status(202).json({ jobId, status: 'accepted' });

    enqueueAutomation(() =>
        runAutomation({
            username,
            password,
            birthYear: dob.year,
            birthMonth: dob.month,
            birthDay: dob.day,
            headless: true
        })
            .then(async (result) => {
                const { gasBills, electricityBills, maintenance } = result;

                // 1. Maintenance case → notify backend immediately
                if (maintenance) {
                    console.log(`Job ${logLabel}: site under maintenance. Notifying backend...`);
                    try {
                        await postBillsToStoreData(storeDataToken, [], [], true);
                    } catch (err) {
                        console.error(`Job ${logLabel}: failed to notify backend about maintenance:`, err.message);
                    }
                    return;
                }

                // 2. Normal run – log what we got
                console.log(
                    `Job ${logLabel} scraped: ` +
                    `${gasBills.length} gas bill(s), ${electricityBills.length} electricity bill(s).`
                );

                // 3. If both are empty, skip submission (avoid a call with no data)
                if (gasBills.length === 0 && electricityBills.length === 0) {
                    console.warn(`Job ${logLabel}: no bills parsed, skipping store-data submission.`);
                    return;
                }

                // 4. Post combined data
                try {
                    await postBillsToStoreData(storeDataToken, gasBills, electricityBills);
                } catch (err) {
                    console.error(`Job ${logLabel}: failed to submit bills to store-data endpoint:`, err.message);
                }
            })
            .catch((err) => {
                console.error(`Automation failed for job ${logLabel}:`, err);
            })
    );
});

app.listen(PORT, () => {
    console.log(`Greenify automation microservice listening on port ${PORT}`);
});