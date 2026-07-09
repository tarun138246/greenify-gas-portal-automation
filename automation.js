// automation.js
const { chromium } = require('playwright');

// ---------- Japanese → English translation map ----------
const translationMap = {
    "ご使用期間": "Usage Period",
    "ご使用日数": "Usage Days",
    "ご使用量": "Usage Amount",
    "内訳": "Breakdown",
    "今回指針": "Current Reading",
    "前回指針": "Previous Reading",
    "メータ番号": "Meter Number",
    "ご請求予定額": "Estimated Bill",
    "ガス料金": "Gas Charge",
    "延滞利息": "Late Payment Interest",
    "警報器リース代金等": "Alarm Lease Fee, etc.",
    "～": " to "               // tilde used as range separator
};

/**
 * Replace all known Japanese labels with English.
 */
function translateLabels(text) {
    let result = text;
    for (const [jp, en] of Object.entries(translationMap)) {
        result = result.split(jp).join(en);
    }
    return result;
}

/**
 * Find a line starting with `label` and return whatever trails it on that
 * same line (tab/space/colon separated). Returns null if not found.
 */
function extractLineValue(text, label) {
    const lines = text.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith(label)) {
            return trimmed.slice(label.length).replace(/^[\t: ]+/, '').trim();
        }
    }
    return null;
}

/**
 * Parse a "N,NNN JPY" / "N JPY" style value into an integer amount.
 * Returns null if no numeric value can be found.
 */
function parseYenAmount(raw) {
    if (!raw) return null;
    const match = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

/**
 * Build the exact bill object the /api/store-data endpoint expects from the
 * four translated/converted table snippets scraped for a single month.
 */
function parseBillFromTables(data1, data2, data3, data4) {
    const periodMatch = data1.match(/(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/);
    const daysMatch = data2.match(/(\d+)\s*days/);

    const usageAmountRaw = extractLineValue(data3, 'Usage Amount');
    const usageAmountMatch = usageAmountRaw ? usageAmountRaw.match(/^(\d+(?:\.\d+)?)\s*(.*)$/) : null;

    const currentReadingRaw = extractLineValue(data3, 'Current Reading');
    const previousReadingRaw = extractLineValue(data3, 'Previous Reading');
    const meterNumber = extractLineValue(data3, 'Meter Number');

    const estimatedBillRaw = extractLineValue(data4, 'Estimated Bill');
    const gasChargeRaw = extractLineValue(data4, 'Gas Charge');
    const lateInterestRaw = extractLineValue(data4, 'Late Payment Interest');
    const alarmLeaseRaw = extractLineValue(data4, 'Alarm Lease Fee, etc.');

    const missing = [];
    if (!periodMatch) missing.push('usage period');
    if (!daysMatch) missing.push('usage days');
    if (!usageAmountMatch) missing.push('usage amount');
    if (currentReadingRaw == null) missing.push('current reading');
    if (previousReadingRaw == null) missing.push('previous reading');
    if (!meterNumber) missing.push('meter number');
    if (parseYenAmount(estimatedBillRaw) == null) missing.push('estimated bill');
    if (parseYenAmount(gasChargeRaw) == null) missing.push('gas charge');

    if (missing.length > 0) {
        throw new Error(`Could not parse required field(s): ${missing.join(', ')}`);
    }

    return {
        usagePeriodStart: periodMatch[1],
        usagePeriodEnd: periodMatch[2],
        usageDays: Number(daysMatch[1]),
        usageAmount: Number(usageAmountMatch[1]),
        unit: usageAmountMatch[2].trim(),
        currentReading: Number(currentReadingRaw),
        previousReading: Number(previousReadingRaw),
        meterNumber: String(meterNumber),
        estimatedBill: parseYenAmount(estimatedBillRaw),
        currency: 'JPY',
        usageCharge: parseYenAmount(gasChargeRaw),
        latePaymentInterest: parseYenAmount(lateInterestRaw) || 0,
        alarmLeaseFee: parseYenAmount(alarmLeaseRaw) || 0
    };
}

/**
 * Convert Japanese date, unit, and currency patterns to pure English.
 */
function convertJapaneseContentToEnglish(text) {
    let result = text;

    // 1. Convert Japanese date format: YYYY年M月D日 → YYYY-MM-DD (padded)
    result = result.replace(
        /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
        (_, y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    );

    // 2. Replace "日間" (days) with " days", keeping the preceding number
    result = result.replace(/(\d+)日間/g, '$1 days');

    // 3. Replace "円" (yen) with " JPY"
    result = result.replace(/円/g, ' JPY');

    // 4. Remove any lingering Japanese full-width spaces / control characters
    result = result.replace(/[　]/g, ' ');

    return result;
}

/**
 * Runs the Saibu Gas mypage scraping automation for a single account.
 *
 * @param {Object} params
 * @param {string} params.username
 * @param {string} params.password
 * @param {string|number} params.birthYear
 * @param {string|number} params.birthMonth
 * @param {string|number} params.birthDay
 * @param {boolean} [params.headless=true]
 * @returns {Promise<string>} the scraped & translated data, joined as a single string
 */
async function runAutomation({ username, password, birthYear, birthMonth, birthDay, headless = true }) {
    if (!username || !password) {
        throw new Error('Missing username or password');
    }
    if (!birthYear || !birthMonth || !birthDay) {
        throw new Error('Missing birth date fields');
    }

    const browser = await chromium.launch({
        headless,
        slowMo: headless ? 0 : 60
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(90000);

    try {
        // ================= LOGIN =================
        console.log("Navigating to login page...");
        await page.goto(
            "https://mypage.saibugas.co.jp/login?act=logout",
            { waitUntil: "domcontentloaded" }
        );

        await page.locator("#userid").fill(username);
        console.log("Username filled.");

        await page.locator("#password").fill(password);
        console.log("Password filled.");

        await page.locator(".btn-login").click();
        console.log("Login button clicked.");

        await page.locator("#birth_year").waitFor({
            state: "visible",
            timeout: 20000
        });
        console.log("Birth date form loaded.");

        await page.locator("#birth_year").selectOption(String(birthYear));
        console.log(`Selected birth year: ${birthYear}`);

        await page.locator("#birth_month").selectOption(String(birthMonth));
        console.log(`Selected birth month: ${birthMonth}`);

        await page.locator("#birth_day").selectOption(String(birthDay));
        console.log(`Selected birth day: ${birthDay}`);

        await page.locator(".btn-submit").click();
        console.log("Birth date submitted.");

        await page.waitForLoadState("networkidle", { timeout: 60000 });
        console.log("Dashboard loaded.");

        // ================= CLOSE POPUP =================
        const closeBtn = page.locator(".btn_close");
        if (await closeBtn.isVisible()) {
            await closeBtn.click();
            console.log("Popup closed.");
        }

        // ================= OPEN SCREENING PAGE =================
        await page
            .locator('a.nav--screening[href="/screening"]')
            .filter({ visible: true })
            .click();
        console.log("Screening link clicked.");

        await page.waitForLoadState("networkidle", { timeout: 60000 });
        await page.waitForTimeout(2000);

        // ================= DETERMINE STARTING ROW WITH FALLBACK =================
        const monthlyTable = page.locator('table.table-amount-charge-monthly').first();
        await monthlyTable.waitFor({ state: 'visible', timeout: 10000 });

        let startRow = null;

        for (let candidate = 1; candidate <= 2; candidate++) {
            const rowBtn = monthlyTable.locator(`xpath=./tbody/tr[${candidate}]/td/a`);
            if (await rowBtn.count() > 0) {
                startRow = candidate;
                break;
            }
        }

        if (!startRow) {
            console.log("No clickable rows found (checked row 1 and 2). Exiting data extraction.");
            return { bills: [], rawText: 'No data rows found.' };
        }

        console.log(`Starting data extraction from row ${startRow}. Will process up to 6 rows.`);

        let allScrapedData = [];
        let bills = [];
        const rowsToProcess = 6;

        for (let i = startRow; i < startRow + rowsToProcess; i++) {
            console.log(`\n--- Processing row ${i} ---`);

            const table = page.locator('table.table-amount-charge-monthly').first();
            await table.waitFor({ state: 'visible', timeout: 10000 });

            const rowButton = table.locator(`xpath=./tbody/tr[${i}]/td/a`);
            const buttonCount = await rowButton.count();

            if (buttonCount === 0) {
                console.log(`Row ${i} does not exist. Stopping.`);
                break;
            }

            await rowButton.click();
            console.log(`Clicked button in row ${i}.`);

            await page.waitForLoadState("networkidle", { timeout: 60000 });
            await page.waitForTimeout(1000);

            // ================= SCRAPE, TRANSLATE & CLEAN =================
            const infoTable = page.locator('table.table-amount-information.table-amount-information--amount-screening').first();
            await infoTable.waitFor({ state: 'visible', timeout: 10000 });

            let data1 = await page.locator('xpath=//*[@id="screeningForm"]/div/div/div[1]/table[1]/tbody/tr[2]').innerText();
            let data2 = await page.locator('xpath=//*[@id="screeningForm"]/div/div/div[1]/table[1]/tbody/tr[3]').innerText();
            let data3 = await page.locator('xpath=//*[@id="screeningForm"]/div/div/div[1]/div/table[1]/tbody').innerText();
            let data4 = await page.locator('xpath=//*[@id="screeningForm"]/div/div/div[1]/div/table[2]/tbody').innerText();

            data1 = translateLabels(data1);
            data2 = translateLabels(data2);
            data3 = translateLabels(data3);
            data4 = translateLabels(data4);

            data1 = convertJapaneseContentToEnglish(data1);
            data2 = convertJapaneseContentToEnglish(data2);
            data3 = convertJapaneseContentToEnglish(data3);
            data4 = convertJapaneseContentToEnglish(data4);

            const monthData = `
========== MONTH ${i} ==========
Row 2:
${data1}

Row 3:
${data2}

Div Table 1:
${data3}

Div Table 2:
${data4}
`;
            allScrapedData.push(monthData);

            try {
                bills.push(parseBillFromTables(data1, data2, data3, data4));
            } catch (err) {
                console.error(`Skipping row ${i}: ${err.message}`);
            }

            const lastPossibleRow = startRow + rowsToProcess - 1;
            if (i < lastPossibleRow) {
                await page.goBack();
                await page.waitForLoadState("networkidle", { timeout: 60000 });
                await page.waitForTimeout(1000);
            }
        }

        console.log("Automation completed successfully.");
        return { bills, rawText: allScrapedData.join('\n') };

    } finally {
        await page.waitForTimeout(headless ? 0 : 5000);
        await browser.close();
    }
}

module.exports = { runAutomation };
