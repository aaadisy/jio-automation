const fs = require("fs");
const express = require("express");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionPath = "./amazonSession.json";

const loginUrl =
  "https://www.amazon.in/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.in%2F%3Fref_%3Dnav_ya_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=inflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0";
const rechargeUrl = "https://www.amazon.in/apay/landing/mobile-prepaid";

// Keep global references
let browser, page;

// ================= SESSION HELPERS =================
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
  fs.writeFileSync(
    sessionPath,
    JSON.stringify({ cookies, localStorage: localStorageData }, null, 2)
  );
}

async function loadSession(page) {
  if (!fs.existsSync(sessionPath)) return false;
  const session = JSON.parse(fs.readFileSync(sessionPath));
  if (session.cookies) await page.setCookie(...session.cookies);
  await page.goto("https://www.amazon.in", { waitUntil: "domcontentloaded" });
  if (session.localStorage) {
    await page.evaluate((storage) => {
      for (let key in storage) localStorage.setItem(key, storage[key]);
    }, session.localStorage);
  }
  return true;
}

async function isLoggedIn(page) {
  const url = page.url();

  if (
    url.includes("youraccount") ||
    url.includes("ref_=nav_signin") ||
    url.includes("gp/homepage")
  ) {
    return true;
  }

  const helloUser = await page.$("#nav-link-accountList span.nav-line-1");
  if (helloUser) {
    const text = await page.evaluate((el) => el.innerText, helloUser);
    if (text && !text.includes("Sign in")) {
      return true;
    }
  }

  if (await page.$("a#nav-item-signout, a[href*='signout']")) {
    return true;
  }

  return false;
}

// ================= BROWSER LAUNCH HELPER =================
async function launchBrowser() {
  return await puppeteer.launch({
    headless: chromium.headless,
    args: chromium.args,
    executablePath: await chromium.executablePath(), // <-- FIXED
    defaultViewport: chromium.defaultViewport,
  });
}


// ================= API: SIGNIN =================
app.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Missing email/password" });

  try {
    browser = await launchBrowser();
    page = await browser.newPage();
    await page.goto(loginUrl, { waitUntil: "networkidle2" });

    await page.type("#ap_email", email, { delay: 50 });
    await page.click("#continue");
    await page.waitForTimeout(2000);

    await page.type("#ap_password", password, { delay: 50 });

    try {
      await page.waitForSelector("input[name='rememberMe']", { timeout: 2000 });
      await page.evaluate(() => {
        const cb = document.querySelector("input[name='rememberMe']");
        if (cb && !cb.checked) cb.click();
      });
    } catch (e) {}

    await page.click("#signInSubmit");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});

    if (
      (await page.$("input[name='otpCode']")) ||
      (await page.$("#auth-mfa-otpcode")) ||
      (await page.$("input[name='code']"))
    ) {
      return res.json({
        status: "otp_required",
        message: "Please submit OTP via /submit-otp",
      });
    }

    if (await isLoggedIn(page)) {
      await saveSession(page);
      return res.json({ status: "success", message: "Logged in without OTP" });
    }

    return res.status(401).json({ status: "failed", message: "Login failed" });
  } catch (err) {
    console.error("Signin error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================= API: SUBMIT OTP =================
app.post("/submit-otp", async (req, res) => {
  const { otp } = req.body;
  if (!otp) return res.status(400).json({ error: "Missing OTP" });

  try {
    const otpSelector = (await page.$("input[name='otpCode']"))
      ? "input[name='otpCode']"
      : (await page.$("#auth-mfa-otpcode"))
      ? "#auth-mfa-otpcode"
      : "input[name='code']";

    await page.type(otpSelector, otp, { delay: 50 });

    try {
      await page.waitForSelector("#auth-mfa-remember-device", { timeout: 2000 });
      await page.evaluate(() => {
        const cb = document.querySelector("#auth-mfa-remember-device");
        if (cb && !cb.checked) cb.click();
      });
    } catch (e) {}

    await page.click("input[type='submit']");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });

    if (await isLoggedIn(page)) {
      await saveSession(page);
      return res.json({ status: "success", message: "OTP accepted, logged in" });
    } else {
      return res.status(401).json({ status: "failed", message: "OTP invalid or login failed" });
    }
  } catch (err) {
    console.error("OTP error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================= API: RECHARGE =================
app.post("/recharge", async (req, res) => {
  const { mobileNumber, amount } = req.body;
  if (!mobileNumber || !amount)
    return res.status(400).json({ error: "Missing mobileNumber/amount" });

  try {
    const rechargeBrowser = await launchBrowser();
    const rechargePage = await rechargeBrowser.newPage();

    if (!(await loadSession(rechargePage)) || !(await isLoggedIn(rechargePage))) {
      return res
        .status(401)
        .json({ success: false, error: "Session expired, please login again" });
    }

    await rechargePage.goto(rechargeUrl, { waitUntil: "networkidle2" });

    const mobileInputHandle = await rechargePage.evaluateHandle(() => {
      const el = document.querySelector("tux-input[name='landingPageMobileNumber']");
      return el && el.shadowRoot.querySelector("input");
    });
    const mobileInput = mobileInputHandle.asElement();
    if (!mobileInput) throw new Error("Mobile input not found");

    await mobileInput.type(mobileNumber, { delay: 100 });
    await rechargePage.waitForTimeout(1000);
    await mobileInput.press("Tab");
    await rechargePage.keyboard.type(amount, { delay: 100 });

    await rechargePage.waitForTimeout(2000);
    await rechargePage.keyboard.press("Tab");
    await rechargePage.keyboard.press("Tab");
    await rechargePage.keyboard.press("Enter");

    await rechargePage.waitForSelector("input[name='ppw-instrumentRowSelection']", {
      visible: true,
      timeout: 20000,
    });
    await rechargePage.click("input[name='ppw-instrumentRowSelection'][value*='APB']");
    await rechargePage.click(
      "input[name='ppw-widgetEvent:SetPaymentPlanSelectContinueEvent']"
    );

    await rechargePage.waitForSelector(".tran-id-sec.tux-text", { timeout: 30000 });
    const orderId = await rechargePage.evaluate(() => {
      const el = document.querySelector(".tran-id-sec.tux-text");
      return el ? el.innerText.replace("Order ID: ", "").trim() : null;
    });

    if (orderId) {
      res.json({ success: true, message: "Recharge completed", orderId });
    } else {
      res.json({ success: false, message: "Recharge may have failed — Order ID not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= API: CLEAR SESSION =================
app.post("/clear-session", (req, res) => {
  if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  res.json({ success: true, message: "Session cleared" });
});

// ================= START SERVER =================
app.listen(PORT, () => console.log(`🚀 API running on http://localhost:${PORT}`));
