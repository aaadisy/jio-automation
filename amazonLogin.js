const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");

const app = express();
app.use(express.json());

const sessionPath = "./amazonSession.json";
const loginUrl = "https://www.amazon.in/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.in%2F%3Fref_%3Dnav_ya_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=inflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0";
const rechargeUrl = "https://www.amazon.in/apay/landing/mobile-prepaid";

let otpWaiters = new Map(); // pending OTP callbacks

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
    await page.evaluate(storage => {
      for (let key in storage) localStorage.setItem(key, storage[key]);
    }, session.localStorage);
  }
  return true;
}

async function isLoggedIn(page) {
  const url = page.url();

  // Common post-login URLs
  if (url.includes("youraccount") || url.includes("ref_=nav_signin") || url.includes("gp/homepage")) {
    return true;
  }

  // Check for "Hello, <Name>" in the nav bar
  const helloUser = await page.$("#nav-link-accountList span.nav-line-1");
  if (helloUser) {
    const text = await page.evaluate(el => el.innerText, helloUser);
    if (text && !text.includes("Sign in")) {
      return true;
    }
  }

  // Check if "Sign Out" link exists
  if (await page.$("a#nav-item-signout, a[href*='signout']")) {
    return true;
  }

  return false;
}


// ================= API: SIGNIN =================
// --- SIGNIN API ---
app.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

  try {
    browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

    page = await browser.newPage();
    await page.goto(loginUrl, { waitUntil: "networkidle2" });

    await page.type("#ap_email", email, { delay: 50 });
    await page.click("#continue");
    await new Promise(r => setTimeout(r, 2000));

    await page.type("#ap_password", password, { delay: 50 });
   // ✅ Check "Keep me signed in" if exists
try {
  await page.waitForSelector("input[name='rememberMe']", { timeout: 2000 });
  await page.evaluate(() => {
    const cb = document.querySelector("input[name='rememberMe']");
    if (cb && !cb.checked) cb.click();
  });
} catch (e) {
  console.log("ℹ️ Remember me checkbox not found, skipping...");
}

// ✅ Now click Sign In
await page.click("#signInSubmit");

    // ✅ Wait a bit to see what page loads
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});

    console.log("After login, landed on:", page.url());
const html = await page.content();
console.log("Page snippet:", html.substring(0, 500)); // first 500 chars


    // 🔍 CASE 1: OTP screen appears
    if (await page.$("input[name='otpCode']") || await page.$("#auth-mfa-otpcode") || await page.$("input[name='code']")) {
      return res.json({ status: "otp_required", message: "Please submit OTP via /submit-otp" });
    }

    // 🔍 CASE 2: Logged in successfully without OTP
    if (await isLoggedIn(page)) {
      await saveSession(page);
      return res.json({ status: "success", message: "Logged in without OTP" });
    }

    // ❌ Otherwise → real failure
    return res.status(401).json({ status: "failed", message: "Login failed" });
  } catch (err) {
    console.error("Signin error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
app.post("/submit-otp", async (req, res) => {
  const { otp } = req.body;
  if (!otp) return res.status(400).json({ error: "Missing OTP" });

  try {
    // Try all possible OTP fields
    const otpSelector = (await page.$("input[name='otpCode']"))
      ? "input[name='otpCode']"
      : (await page.$("#auth-mfa-otpcode"))
      ? "#auth-mfa-otpcode"
      : "input[name='code']";

    await page.type(otpSelector, otp, { delay: 50 });

// ✅ Tick "Don’t ask for codes on this device"
try {
  await page.waitForSelector("#auth-mfa-remember-device", { timeout: 2000 });
  await page.evaluate(() => {
    const cb = document.querySelector("#auth-mfa-remember-device");
    if (cb && !cb.checked) cb.click();
  });
} catch (e) {
  console.log("ℹ️ Remember device checkbox not found, skipping...");
}

// ✅ Submit OTP
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

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  try {
    if (!(await loadSession(page)) || !(await isLoggedIn(page))) {
      return res
        .status(401)
        .json({ success: false, error: "Session expired, please login again" });
    }

    await page.goto(rechargeUrl, { waitUntil: "networkidle2" });

    // Input inside shadowRoot
    const mobileInputHandle = await page.evaluateHandle(() => {
      const el = document.querySelector(
        "tux-input[name='landingPageMobileNumber']"
      );
      return el && el.shadowRoot.querySelector("input");
    });
    const mobileInput = mobileInputHandle.asElement();
    if (!mobileInput) throw new Error("Mobile input not found");

    await mobileInput.type(mobileNumber, { delay: 100 });
    await new Promise(r => setTimeout(r, 1000));
    await mobileInput.press("Tab");

    await page.keyboard.type(amount, { delay: 100 });
    console.log("✅ Entered amount");

  // Wait + press Tab to move focus away
  await new Promise(r => setTimeout(r, 2000));
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  // ---- Press Enter to trigger Pay Now ----
  await page.keyboard.press("Enter", { delay: 120 });
  console.log("✅ Clicked Pay now button");

    // Select Amazon Pay Balance
    await page.waitForSelector("input[name='ppw-instrumentRowSelection']", {
      visible: true,
      timeout: 20000,
    });
    await page.click(
      "input[name='ppw-instrumentRowSelection'][value*='APB']"
    );
    await page.click(
      "input[name='ppw-widgetEvent:SetPaymentPlanSelectContinueEvent']"
    );

    // ✅ Wait until Order ID is visible
await page.waitForSelector(".tran-id-sec tux-text", { timeout: 30000 });

// ✅ Extract Order ID using evaluate
const orderId = await page.evaluate(() => {
  const el = document.querySelector(".tran-id-sec tux-text");
  if (!el) return null;
  return el.innerText.replace("Order ID: ", "").trim();
});

// ✅ Check & return response
if (orderId) {
  res.json({
    success: true,
    message: "Recharge completed",
    orderId: orderId
  });
} else {
  res.json({
    success: false,
    message: "Recharge may have failed — Order ID not found"
  });
}




   
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
   // await browser.close();
  }
});

// ================= API: CLEAR SESSION =================
app.post("/clear-session", (req, res) => {
  if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  res.json({ success: true, message: "Session cleared" });
});

app.listen(3000, () =>
  console.log("🚀 API running on http://localhost:3000")
);
