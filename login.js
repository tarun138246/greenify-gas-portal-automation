// login.js
// Manual/local CLI runner — reads credentials from .env and writes data.txt,
// same behavior as before. The core automation logic now lives in automation.js
// so it can be shared with the server.js microservice.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { runAutomation } = require('./automation');

(async () => {
    const USERNAME = process.env.MY_USERNAME;
    const PASSWORD = process.env.MY_PASSWORD;
    const BIRTH_YEAR = process.env.MY_BIRTH_YEAR;
    const BIRTH_MONTH = process.env.MY_BIRTH_MONTH;
    const BIRTH_DAY = process.env.MY_BIRTH_DAY;

    if (!USERNAME || !PASSWORD) {
        console.error('ERROR: Missing MY_USERNAME or MY_PASSWORD in .env');
        process.exit(1);
    }

    if (!BIRTH_YEAR || !BIRTH_MONTH || !BIRTH_DAY) {
        console.error('ERROR: Missing birth date variables in .env');
        process.exit(1);
    }

    try {
        const data = await runAutomation({
            username: USERNAME,
            password: PASSWORD,
            birthYear: BIRTH_YEAR,
            birthMonth: BIRTH_MONTH,
            birthDay: BIRTH_DAY,
            headless: false
        });

        const filePath = path.join(__dirname, 'data.txt');
        fs.writeFileSync(filePath, data, 'utf8');
        console.log(`\nAll data saved to ${filePath}`);
    } catch (err) {
        console.error('Automation failed:', err);
        process.exit(1);
    }
})();
