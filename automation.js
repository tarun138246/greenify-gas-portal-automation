// automation.js
const { chromium } = require('playwright');

// ---------- Japanese → English translation map ----------
const translationMap = {
    // gas
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
    "～": " to ",

    // electricity
    "電気ご使用量のおしらせ": "Electricity Usage Notification",
    "ご契約種別": "Contract Type",
    "ご契約容量": "Contract Capacity",
    "今回検針日": "Current Reading Date",
    "計器番号": "Meter Number",
    "前月ご使用量": "Previous Month Usage",
    "前年同月ご使用量": "Same Month Last Year Usage",
    "ご請求予定額（円未満は切り捨て）": "Estimated Bill (rounded down to yen)",
    "基本料金": "Base Charge",
    "電力量料金": "Electricity Charge",
    "燃料費調整額": "Fuel Cost Adjustment",
    "再エネ賦課金": "Renewable Energy Surcharge",
    "(内消費税等相当額)": "(including consumption tax equivalent)",
    "ご契約内容の変更があった場合には、端数処理の関係で内訳の合計がご請求予定額と合わないことがあります。":
        "If there is a change in contract details, the total of the breakdown may not match the estimated bill due to rounding.",
    "燃料費調整額単価（当月）": "Fuel Cost Adjustment Unit Price (Current Month)",
    "燃料費調整額単価（翌月）": "Fuel Cost Adjustment Unit Price (Next Month)",
    "次回検針予定日": "Next Reading Scheduled Date",
    "電気ご使用量明細": "Electricity Usage Breakdown",
    "電力量１段料金": "Tier 1 Rate",
    "電力量２段料金": "Tier 2 Rate",
    "電力量３段料金": "Tier 3 Rate",
};

// Additional translations for specific plan names etc.
const additionalTranslations = {
    "プラスでんきプラン１": "Plus Denki Plan 1",
    "プラスでんきプラン２": "Plus Denki Plan 2",
    "プラスでんきプラン３": "Plus Denki Plan 3",
    // add more as needed
};

// Sort keys by length descending for correct replacement
const sortedTranslationKeys = Object.keys(translationMap).sort((a, b) => b.length - a.length);

function translateLabels(text) {
    let result = text;
    for (const jp of sortedTranslationKeys) {
        const en = translationMap[jp];
        result = result.split(jp).join(en);
    }
    // Apply additional translations (plan names, etc.) that might remain
    for (const [jp, en] of Object.entries(additionalTranslations)) {
        result = result.split(jp).join(en);
    }
    return result;
}

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

function parseYenAmount(raw) {
    if (!raw) return null;
    const match = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

// ---------- Gas bill parsing (unchanged) ----------
function parseGasBillFromTables(data1, data2, data3, data4) {
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
        throw new Error(`Could not parse required gas field(s): ${missing.join(', ')}`);
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

// ---------- Electricity bill parsing (FIXED) ----------
function parseElectricBill(originalText) {
    // 1) Translate labels and then convert dates/yen
    let text = translateLabels(originalText);
    text = convertJapaneseContentToEnglish(text);

    // Common fields
    const periodRaw = extractLineValue(text, 'Usage Period');
    const periodMatch = periodRaw ? periodRaw.match(/(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/) : null;

    const daysRaw = extractLineValue(text, 'Usage Days');
    const daysMatch = daysRaw ? daysRaw.match(/(\d+)\s*days/) : null;

    // Contract type: extract after translation (might still be Japanese if not mapped)
    let contractType = extractLineValue(text, 'Contract Type');
    // Apply any remaining translation for known plan names
    if (contractType) {
        for (const [jp, en] of Object.entries(additionalTranslations)) {
            contractType = contractType.replace(jp, en);
        }
    }

    const contractCapacityRaw = extractLineValue(text, 'Contract Capacity');
    const contractCapacity = contractCapacityRaw ? contractCapacityRaw.replace(/[^\d]/g, '') : null;

    const meterNumber = extractLineValue(text, 'Meter Number');

    const usageRaw = extractLineValue(text, 'Usage Amount');
    const usageMatch = usageRaw ? usageRaw.match(/^(\d+(?:\.\d+)?)\s*kWh/) : null;

    const estRaw = extractLineValue(text, 'Estimated Bill (rounded down to yen)');
    const estimatedBill = parseYenAmount(estRaw);

    const baseChargeRaw = extractLineValue(text, 'Base Charge');
    const baseCharge = parseYenAmount(baseChargeRaw);
    const electricityChargeRaw = extractLineValue(text, 'Electricity Charge');
    const electricityCharge = parseYenAmount(electricityChargeRaw);
    const fuelAdjustRaw = extractLineValue(text, 'Fuel Cost Adjustment');
    const fuelAdjust = parseYenAmount(fuelAdjustRaw);
    const renewableRaw = extractLineValue(text, 'Renewable Energy Surcharge');
    const renewable = parseYenAmount(renewableRaw);
    const taxRaw = extractLineValue(text, '(including consumption tax equivalent)');
    const consumptionTax = parseYenAmount(taxRaw);

    // Tiers extraction – search in the "Electricity Usage Breakdown" section only
    let tiers = { tier1Kwh: null, tier1Yen: null, tier2Kwh: null, tier2Yen: null, tier3Kwh: null, tier3Yen: null };
    const breakdownSection = extractBreakdownSection(text);
    if (breakdownSection) {
        const tierLines = breakdownSection.split('\n').filter(line => /Tier [123] Rate/.test(line));
        for (const line of tierLines) {
            const sanitized = line.replace(/,/g, '');
            const match = sanitized.match(/Tier\s+(\d)\s+Rate\s+(\d+(?:\.\d+)?)\s*kWh\s+([\d.]+)\s*JPY/);
            if (match) {
                const tierNum = parseInt(match[1]);
                const kwh = parseFloat(match[2]);
                const yen = parseFloat(match[3]);
                if (tierNum === 1) {
                    tiers.tier1Kwh = kwh;
                    tiers.tier1Yen = yen;
                } else if (tierNum === 2) {
                    tiers.tier2Kwh = kwh;
                    tiers.tier2Yen = yen;
                } else if (tierNum === 3) {
                    tiers.tier3Kwh = kwh;
                    tiers.tier3Yen = yen;
                }
            }
        }
    }

    const missing = [];
    if (!periodMatch) missing.push('usage period');
    if (!daysMatch) missing.push('usage days');
    if (!meterNumber) missing.push('meter number');
    if (!usageMatch) missing.push('usage amount');
    if (estimatedBill == null) missing.push('estimated bill');

    if (missing.length > 0) {
        throw new Error(`Could not parse required electricity field(s): ${missing.join(', ')}`);
    }

    return {
        usagePeriodStart: periodMatch[1],
        usagePeriodEnd: periodMatch[2],
        usageDays: Number(daysMatch[1]),
        usageAmountKwh: Number(usageMatch[1]),
        meterNumber: String(meterNumber),
        estimatedBill,
        currency: 'JPY',
        contractType,
        contractCapacity: contractCapacity ? Number(contractCapacity) : null,
        baseCharge,
        electricityCharge,
        fuelAdjustment: fuelAdjust,
        renewableSurcharge: renewable,
        consumptionTax: consumptionTax,
        tiers
    };
}

// Helper: extract the portion of text under "Electricity Usage Breakdown" until the end
function extractBreakdownSection(text) {
    const lines = text.split('\n');
    const startIndex = lines.findIndex(line => line.includes('Electricity Usage Breakdown'));
    if (startIndex === -1) return null;
    // Take everything from that line onward
    return lines.slice(startIndex).join('\n');
}

function convertJapaneseContentToEnglish(text) {
    let result = text;
    // Dates: 2025年11月13日 → 2025-11-13
    result = result.replace(
        /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
        (_, y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    );
    // Days: 24日間 → 24 days
    result = result.replace(/(\d+)日間/g, '$1 days');
    // Yen symbol → space + JPY
    result = result.replace(/円/g, ' JPY');
    // Full-width spaces to normal space
    result = result.replace(/[　]/g, ' ');
    return result;
}

// ---------- Resource blocking ----------
async function blockResources(page) {
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
            route.abort();
        } else {
            route.continue();
        }
    });
}

// ---------- Maintenance page detection ----------
async function isMaintenancePage(page) {
    try {
        await page.waitForSelector('xpath=/html/body/div[2]/section/div/h1', { timeout: 5000 });
        await page.waitForSelector('xpath=/html/body/div[2]/section/div/p[1]', { timeout: 1000 });
        await page.waitForSelector('xpath=/html/body/div[2]/section/div/p[2]', { timeout: 1000 });
        return true;
    } catch {
        return false;
    }
}

// ---------- Scrape a gas detail page ----------
async function scrapeGasDetail(page, monthIndex) {
    await page.waitForSelector(
        'table.table-amount-information.table-amount-information--amount-screening',
        { state: 'visible', timeout: 10000 }
    );
    await page.waitForTimeout(100);

    const data1 = await page.locator('xpath=//*[@id="screeningForm"]/div/div/div[1]/table[1]/tbody/tr[2]').innerText();
    const data2 = await page.locator('xpath=//*[@id="screeningForm"]/div/div/div[1]/table[1]/tbody/tr[3]').innerText();
    const data3 = await page.locator('xpath=//*[@id="screeningForm"]/div/div/div[1]/div/table[1]/tbody').innerText();
    const data4 = await page.locator('xpath=//*[@id="screeningForm"]/div/div/div[1]/div/table[2]/tbody').innerText();

    const e1 = convertJapaneseContentToEnglish(translateLabels(data1));
    const e2 = convertJapaneseContentToEnglish(translateLabels(data2));
    const e3 = convertJapaneseContentToEnglish(translateLabels(data3));
    const e4 = convertJapaneseContentToEnglish(translateLabels(data4));

    const gasRaw = `
========== GAS MONTH ${monthIndex} ==========
Row 2:
${e1}

Row 3:
${e2}

Div Table 1:
${e3}

Div Table 2:
${e4}
`;

    let gasBill = null;
    try {
        gasBill = parseGasBillFromTables(e1, e2, e3, e4);
    } catch (err) {
        console.error(`Skipping gas month ${monthIndex}: ${err.message}`);
    }
    return { raw: gasRaw, bill: gasBill };
}

// ---------- Scrape an electricity detail page ----------
async function scrapeElectricityDetail(page, monthIndex) {
    await page.waitForSelector(
        'xpath=/html/body/div[2]/section[1]/div/form/div/div/div[1]/table[1]',
        { state: 'visible', timeout: 10000 }
    );
    await page.waitForTimeout(200);

    const table1 = page.locator('xpath=/html/body/div[2]/section[1]/div/form/div/div/div[1]/table[1]');
    const div = page.locator('xpath=/html/body/div[2]/section[1]/div/form/div/div/div[1]/div');
    const table3 = page.locator('xpath=/html/body/div[2]/section[1]/div/form/div/div/div[1]/table[3]');

    const t1 = await table1.innerText();
    const d = await div.innerText();
    const t3 = await table3.innerText();

    const combined = [t1, d, t3].join('\n');

    console.log(`\n===== ELECTRICITY RAW DATA (month ${monthIndex}) =====`);
    console.log(combined);
    console.log(`======================================================\n`);

    const rawEnglish = convertJapaneseContentToEnglish(translateLabels(combined));

    let bill = null;
    try {
        bill = parseElectricBill(combined);
    } catch (err) {
        console.error(`Skipping electricity month ${monthIndex}: ${err.message}`);
    }
    return { raw: rawEnglish, bill };
}

// ---------- Concurrency helper ----------
async function asyncPool(limit, tasks) {
    const results = [];
    const executing = new Set();
    for (const task of tasks) {
        const p = Promise.resolve().then(() => task());
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

// ---------- Main automation ----------
async function runAutomation({ username, password, birthYear, birthMonth, birthDay, headless = true }) {
    if (!username || !password) throw new Error('Missing username or password');
    if (!birthYear || !birthMonth || !birthDay) throw new Error('Missing birth date fields');

    const browser = await chromium.launch({
        headless,
        args: [
            '--disable-gpu',
            '--no-sandbox',
            // /dev/shm defaults to 64MB on EC2; Chromium falls over under
            // memory pressure without this instead of just running slower.
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-software-rasterizer',
            '--disable-features=TranslateUI'
        ]
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await blockResources(page);
    page.setDefaultTimeout(30000);

    try {
        // ================= LOGIN =================
        console.log("Navigating to login page...");
        await page.goto(
            "https://mypage.saibugas.co.jp/login?act=logout",
            { waitUntil: "domcontentloaded" }
        );

        if (await isMaintenancePage(page)) {
            console.log("Site is under maintenance.");
            await browser.close();
            return {
                gasBills: [],
                electricityBills: [],
                rawGasTexts: [],
                rawElectricityTexts: [],
                maintenance: true,
                message: 'Site under maintenance'
            };
        }

        await page.locator("#userid").fill(username);
        await page.locator("#password").fill(password);
        await page.locator(".btn-login").click();

        await page.waitForSelector("#birth_year", { state: "visible", timeout: 15000 });
        await page.locator("#birth_year").selectOption(String(birthYear));
        await page.locator("#birth_month").selectOption(String(birthMonth));
        await page.locator("#birth_day").selectOption(String(birthDay));
        await page.locator(".btn-submit").click();

        await page.waitForSelector('.nav--screening', { timeout: 15000 });
        console.log("Dashboard loaded.");

        // Close any popup
        const closeBtn = page.locator(".btn_close");
        if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await closeBtn.click();
        }

        // ================= NAVIGATE TO METER READING INFORMATION (検針情報) =================
        console.log("Navigating to meter reading information page...");
        await page.locator('a.nav--screening[href="/screening"]:visible').click();
        await page.waitForSelector('table.table-amount-charge-monthly', { timeout: 10000 });
        await page.waitForTimeout(300);

        // ================= COLLECT GAS & ELECTRICITY LINKS (LIMIT 6 EACH) =================
        const monthlyTable = page.locator('table.table-amount-charge-monthly').first();
        const rows = monthlyTable.locator('tbody tr');
        const rowCount = await rows.count();

        const MAX_GAS = 6;
        const MAX_ELEC = 6;

        const gasLinks = [];
        const electricityLinks = [];

        for (let i = 0; i < rowCount; i++) {
            if (gasLinks.length >= MAX_GAS && electricityLinks.length >= MAX_ELEC) break;

            const row = rows.nth(i);

            if (gasLinks.length < MAX_GAS) {
                const gasLink = row.locator('a.gas-btn');
                if (await gasLink.count() > 0) {
                    const href = await gasLink.getAttribute('href');
                    if (href) {
                        gasLinks.push({ index: i + 1, href });
                    }
                }
            }

            if (electricityLinks.length < MAX_ELEC) {
                const elecLink = row.locator('a.electricity-btn');
                if (await elecLink.count() > 0) {
                    const href = await elecLink.getAttribute('href');
                    if (href) {
                        electricityLinks.push({ index: i + 1, href });
                    }
                }
            }
        }

        console.log(`Collected ${gasLinks.length} gas months, ${electricityLinks.length} electricity months.`);

        // ================= BUILD TASK LIST (GAS + ELECTRICITY) =================
        const tasks = [];

        gasLinks.forEach(({ index, href }) => {
            tasks.push(async () => {
                console.log(`Gas scraping month ${index}...`);
                const newPage = await context.newPage();
                await blockResources(newPage);
                try {
                    const fullUrl = new URL(href, page.url()).href;
                    await newPage.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

                    if (await isMaintenancePage(newPage)) {
                        console.log(`Gas month ${index}: maintenance page.`);
                        return { type: 'gas', index, raw: '', bill: null, maintenance: true };
                    }

                    const result = await scrapeGasDetail(newPage, index);
                    console.log(`Finished gas month ${index}`);
                    return { type: 'gas', index, ...result, maintenance: false };
                } catch (err) {
                    console.error(`Gas month ${index} failed: ${err.message}`);
                    return { type: 'gas', index, raw: '', bill: null, maintenance: false };
                } finally {
                    await newPage.close();
                }
            });
        });

        electricityLinks.forEach(({ index, href }) => {
            tasks.push(async () => {
                console.log(`Electricity scraping month ${index}...`);
                const newPage = await context.newPage();
                await blockResources(newPage);
                try {
                    const fullUrl = new URL(href, page.url()).href;
                    await newPage.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

                    if (await isMaintenancePage(newPage)) {
                        console.log(`Electricity month ${index}: maintenance page.`);
                        return { type: 'electricity', index, raw: '', bill: null, maintenance: true };
                    }

                    const result = await scrapeElectricityDetail(newPage, index);
                    console.log(`Finished electricity month ${index}`);
                    return { type: 'electricity', index, ...result, maintenance: false };
                } catch (err) {
                    console.error(`Electricity month ${index} failed: ${err.message}`);
                    return { type: 'electricity', index, raw: '', bill: null, maintenance: false };
                } finally {
                    await newPage.close();
                }
            });
        });

        // ================= EXECUTE ALL TASKS WITH CONCURRENCY =================
        // Each task opens its own tab; on a 2GiB box, 6 concurrent tabs plus
        // the base browser can exceed available RAM. Keep this low unless
        // running on a bigger instance.
        const PAGE_CONCURRENCY = parseInt(process.env.AUTOMATION_PAGE_CONCURRENCY || '2', 10);
        const allResults = await asyncPool(PAGE_CONCURRENCY, tasks);

        // ================= ORGANISE RESULTS =================
        const gasBills = [];
        const electricityBills = [];
        const rawGasTexts = [];
        const rawElectricityTexts = [];
        const maintenanceIndices = [];

        allResults.forEach(res => {
            if (res.maintenance) {
                maintenanceIndices.push({ type: res.type, index: res.index });
            }
            if (res.type === 'gas') {
                if (res.bill) gasBills.push(res.bill);
                if (res.raw) rawGasTexts.push(res.raw);
            } else if (res.type === 'electricity') {
                if (res.bill) electricityBills.push(res.bill);
                if (res.raw) rawElectricityTexts.push(res.raw);
            }
        });

        console.log("Automation completed successfully.");
        return {
            gasBills,
            electricityBills,
            rawGasTexts,
            rawElectricityTexts,
            maintenanceIndices
        };

    } finally {
        await browser.close();
    }
}

module.exports = { runAutomation };