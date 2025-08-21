const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // show browser
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // 1. Open Jio recharge page
  await page.goto(
    "https://www.jio.com/selfcare/recharge/mobility/?entrysource=Mobilepage%20header",
    { waitUntil: "networkidle2" }
  );

  // 2. Enter mobile number
  const mobileNumber = "7080013463"; // replace with your number
  await page.waitForSelector("#submitNumber", { visible: true });
  await page.type("#submitNumber", mobileNumber, { delay: 100 });

  // 3. Click Continue button
  await page.waitForSelector('button[aria-label="button Continue"]', { visible: true });
  await page.click('button[aria-label="button Continue"]');
  await new Promise(r => setTimeout(r, 5000));

  // 4. Select ₹349 plan
  await page.waitForSelector(".Details_planCard__1lyyX", { visible: true });
  const plans = await page.$$(".Details_planCard__1lyyX");

  for (const plan of plans) {
    const price = await plan.$eval(".PlanName_planText__3e7m1", el => el.innerText);
    if (price.includes("349")) {
      const buyButton = await plan.$('button[aria-label="button"]');
      await buyButton.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 10000));

  // -----------------------------
  // 5. Click on Wallets
  // -----------------------------
  await page.waitForSelector("div.j-listBlock__block-text div", { visible: true });

  const clickedWallet = await page.evaluate(() => {
    const allDivs = document.querySelectorAll("div.j-listBlock__block-text div");
    const target = Array.from(allDivs).find(el => el.innerText.includes("Wallets"));
    if (target) {
      const clickable = target.closest(".j-listBlock");
      if (clickable) {
        clickable.scrollIntoView({ behavior: "smooth", block: "center" });
        clickable.click();
        return true;
      }
    }
    return false;
  });

  if (clickedWallet) {
    console.log("✅ Clicked on Wallets");
  } else {
    console.log("❌ Wallets element not found");
  }

  await new Promise(r => setTimeout(r, 3000));

  // -----------------------------
  // 6. Click on Amazon Pay
  // -----------------------------
  // -----------------------------
// 6. Click on Amazon Pay → Link now
// -----------------------------
await page.waitForSelector(".saved-item1", { visible: true });

const clickedAmazon = await page.evaluate(() => {
  const amazonBlock = document.querySelector(".saved-item1");
  if (amazonBlock && amazonBlock.innerText.includes("Amazon Pay")) {
    const linkNowBtn = amazonBlock.querySelector(".css-4g6ai3");
    if (linkNowBtn) {
      linkNowBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      linkNowBtn.click();
      return true;
    }
  }
  return false;
});

if (clickedAmazon) {
  console.log("✅ Clicked Amazon Pay → Link now");
} else {
  console.log("❌ Amazon Pay link not found");
}

await new Promise(r => setTimeout(r, 3000));


// -----------------------------
// 8. Amazon Pay login
// -----------------------------

// wait for Amazon email/phone input
await page.waitForSelector("#ap_email", { visible: true });

// type mobile number
const amazonMobile = "7080013463"; // your number
await page.type("#ap_email", amazonMobile, { delay: 100 });
console.log("✅ Entered Amazon Pay mobile number");

// click Continue button
await page.waitForSelector("#continue", { visible: true });
await page.click("#continue");
console.log("✅ Clicked Amazon Pay Continue");

// small wait for next page load
await new Promise(r => setTimeout(r, 5000));


// -----------------------------
// 9. Amazon Pay → Continue with OTP
// -----------------------------
try {
  // wait for OTP continue button to appear
  await page.waitForSelector('input#a-button-input, input#continue[aria-labelledby="auth-login-via-otp-btn-announce"]', { 
    visible: true,
    timeout: 10000 
  });
  
  // click OTP continue
  await page.click('input#continue[aria-labelledby="auth-login-via-otp-btn-announce"]');
  console.log("✅ Clicked Amazon Pay Continue via OTP");
} catch (err) {
  console.log("❌ OTP Continue button not found:", err.message);
}

await new Promise(r => setTimeout(r, 5000));

  await new Promise(r => setTimeout(r, 3000));

  console.log("✅ Flow completed (Wallets → Amazon Pay)");

  // await browser.close(); // keep browser open for manual check
})();
