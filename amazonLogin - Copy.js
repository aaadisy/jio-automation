const puppeteer = require("puppeteer");
const fs = require("fs");

const email = "9064237424";
const password = "Kolkata@1111";
const sessionPath = "./amazonSession.json";
const rechargeUrl = "https://www.amazon.in/apay/landing/mobile-prepaid?ref_=gw1_rech_n2pay";

async function saveSession(page) {
  const cookies = await page.cookies();
  const localStorageData = await page.evaluate(() => {
    let json = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      json[key] = localStorage.getItem(key);
    }
    return json;
  });
  const sessionStorageData = await page.evaluate(() => {
    let json = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      json[key] = sessionStorage.getItem(key);
    }
    return json;
  });

  fs.writeFileSync(
    sessionPath,
    JSON.stringify({ cookies, localStorage: localStorageData, sessionStorage: sessionStorageData }, null, 2)
  );
  console.log("💾 Session saved!");
}

async function loadSession(page) {
  if (!fs.existsSync(sessionPath)) return false;
  const session = JSON.parse(fs.readFileSync(sessionPath));

  if (session.cookies) {
    await page.setCookie(...session.cookies);
  }

  await page.goto("https://www.amazon.in", { waitUntil: "domcontentloaded" });

  if (session.localStorage) {
    await page.evaluate(storage => {
      for (let key in storage) {
        localStorage.setItem(key, storage[key]);
      }
    }, session.localStorage);
  }

  if (session.sessionStorage) {
    await page.evaluate(storage => {
      for (let key in storage) {
        sessionStorage.setItem(key, storage[key]);
      }
    }, session.sessionStorage);
  }

  console.log("✅ Session restored!");
  return true;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"],
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
  );

  // Try to restore session
  const restored = await loadSession(page);

  // Check if already logged in
  const nameText = await page.$eval(
    "#nav-link-accountList span.nav-line-1",
    el => el.innerText
  ).catch(() => null);

  if (nameText && !/sign in/i.test(nameText)) {
    console.log("🎉 Already logged in as:", nameText);
    await saveSession(page);
    await page.goto(rechargeUrl, { waitUntil: "networkidle2" });
    console.log("📲 Opened Mobile Recharge Page");
try {
  console.log("📲 Filling recharge details...");

  // ---- Mobile Number ----
  const mobileInputHandle = await page.evaluateHandle(() => {
    const el = document.querySelector("tux-input[name='landingPageMobileNumber']");
    return el && el.shadowRoot.querySelector("input");
  });

  const mobileInput = mobileInputHandle.asElement();
  if (!mobileInput) throw new Error("❌ Mobile number input not found");

  await mobileInput.type("7080013463", { delay: 100 });
  console.log("✅ Entered mobile number");

  // Wait a bit + press Tab → focus will move to Amount input
  await new Promise(r => setTimeout(r, 2000));
  await mobileInput.press("Tab");
  console.log("✅ Tab pressed, amount field focused");

  // ---- Enter Amount directly into focused element ----
  await page.keyboard.type("29", { delay: 120 });
  console.log("✅ Entered amount");

  // Wait + press Tab to move focus away
  await new Promise(r => setTimeout(r, 2000));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  // ---- Press Enter to trigger Pay Now ----
  await page.keyboard.press("Enter", { delay: 120 });
  console.log("✅ Clicked Pay now button");

  // ---- Wait for Payment Page ----
  await page.waitForSelector("input[name='ppw-instrumentRowSelection']", { visible: true, timeout: 30000 });
  console.log("✅ Payment page loaded");

  // ---- Select Amazon Pay Balance ----
  await page.click("input[name='ppw-instrumentRowSelection'][value*='APB']");
  console.log("✅ Selected Amazon Pay Balance");

  // ---- Click Continue ----
  await page.click("input[name='ppw-widgetEvent:SetPaymentPlanSelectContinueEvent']");
  console.log("✅ Clicked Continue");

} catch (err) {
  console.log("⚠️ Could not complete recharge step:", err.message);
}



    return;
  }

  // --- Login flow ---
  console.log("🔐 Logging in...");
  await page.goto("https://www.amazon.in/ap/signin", { waitUntil: "domcontentloaded" });

  // Wait and type email
  await page.waitForSelector("#ap_email", { visible: true, timeout: 15000 });
  await page.type("#ap_email", email, { delay: 100 });
  await page.click("#continue");

  // Wait and type password
  await page.waitForSelector("#ap_password", { visible: true, timeout: 15000 });
  await page.type("#ap_password", password, { delay: 100 });
  await page.click("#signInSubmit");

  // --- OTP Handling ---
  try {
    await page.waitForSelector("input[name='otpCode']", { timeout: 5000 });
    console.log("🔑 OTP required!");

    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const otp = await new Promise(resolve => {
      rl.question("Enter OTP sent to your device: ", ans => {
        rl.close();
        resolve(ans.trim());
      });
    });

    await page.type("input[name='otpCode']", otp, { delay: 100 });
    await page.click("input[type='submit']");
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    console.log("✅ Logged in with OTP!");
  } catch (err) {
    console.log("✅ No OTP requested.");
  }

  // Confirm login
  const nameTextAfter = await page.$eval(
    "#nav-link-accountList span.nav-line-1",
    el => el.innerText
  ).catch(() => null);

  if (nameTextAfter && !/sign in/i.test(nameTextAfter)) {
    console.log("🎉 Logged in as:", nameTextAfter);
    await saveSession(page);
    await page.goto(rechargeUrl, { waitUntil: "networkidle2" });
    console.log("📲 Opened Mobile Recharge Page");
  } else {
    console.log("⚠️ Login might have failed. Please check manually.");
  }

  // Keep browser open
  // await browser.close();
})();
