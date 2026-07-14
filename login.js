// login.js
// Manual/local CLI runner — reads credentials from .env and saves output files
// Updated to work with the new dual (gas + electricity) automation structure.
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
        const result = await runAutomation({
            username: USERNAME,
            password: PASSWORD,
            birthYear: BIRTH_YEAR,
            birthMonth: BIRTH_MONTH,
            birthDay: BIRTH_DAY,
            headless: false          // set true for production
        });

        // Handle maintenance case
        if (result.maintenance) {
            console.log('Site is under maintenance. No data saved.');
            process.exit(0);
        }

        // Destructure the new return format
        const {
            gasBills,
            electricityBills,
            rawGasTexts,
            rawElectricityTexts,
            maintenanceIndices
        } = result;

        // Save raw gas texts
        if (rawGasTexts && rawGasTexts.length > 0) {
            const gasRawPath = path.join(__dirname, 'gas_raw.txt');
            fs.writeFileSync(gasRawPath, rawGasTexts.join('\n'), 'utf8');
            console.log(`Gas raw data saved to ${gasRawPath}`);
        }

        // Save raw electricity texts
        if (rawElectricityTexts && rawElectricityTexts.length > 0) {
            const elecRawPath = path.join(__dirname, 'electricity_raw.txt');
            fs.writeFileSync(elecRawPath, rawElectricityTexts.join('\n'), 'utf8');
            console.log(`Electricity raw data saved to ${elecRawPath}`);
        }

        // Save gas bills JSON
        if (gasBills && gasBills.length > 0) {
            const gasBillsPath = path.join(__dirname, 'gas_bills.json');
            fs.writeFileSync(gasBillsPath, JSON.stringify(gasBills, null, 2), 'utf8');
            console.log(`Gas bills saved to ${gasBillsPath} (${gasBills.length} bill(s))`);
        }

        // Save electricity bills JSON
        if (electricityBills && electricityBills.length > 0) {
            const elecBillsPath = path.join(__dirname, 'electricity_bills.json');
            fs.writeFileSync(elecBillsPath, JSON.stringify(electricityBills, null, 2), 'utf8');
            console.log(`Electricity bills saved to ${elecBillsPath} (${electricityBills.length} bill(s))`);
        }

        // Log any maintenance indices encountered
        if (maintenanceIndices && maintenanceIndices.length > 0) {
            console.log('Maintenance pages encountered for:', maintenanceIndices);
        }

        console.log('Automation run completed successfully.');
    } catch (err) {
        console.error('Automation failed:', err);
        process.exit(1);
    }
})();