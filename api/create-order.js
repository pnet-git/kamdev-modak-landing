// Vercel serverless function: creates a Cashfree order server-side and returns payment_session_id.
// Secret key is read from environment variables (set in Vercel dashboard) — never hardcoded.

const PACKS = {
  trial:     { amount: 1490,  label: "Trial Pack (7 Modak)" },
  monthly:   { amount: 5550,  label: "Monthly Pack (30 Modak)" },
  quarterly: { amount: 15000, label: "3-Month Transformation (90 Modak)" }
};

module.exports = async (req, res) => {
  // CORS (same-origin in prod, but safe defaults)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Parse body (Vercel may give string or object)
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { pack, name, email, phone } = body;

    const chosen = PACKS[pack] || PACKS.monthly;

    // basic validation — international friendly (8-15 digits)
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    if (cleanPhone.length < 8 || cleanPhone.length > 15) {
      return res.status(400).json({ error: "Valid phone required" });
    }

    const ENV = (process.env.CASHFREE_ENV || "sandbox").toLowerCase();
    const APP_ID = process.env.CASHFREE_APP_ID;
    const SECRET = process.env.CASHFREE_SECRET_KEY;
    if (!APP_ID || !SECRET) {
      return res.status(500).json({ error: "Payment not configured" });
    }

    const BASE = ENV === "production"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg";

    const orderId = "modak_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

    // return_url sends the buyer to our thank-you page with amount + pack for the Purchase pixel
    const origin = req.headers.origin || "https://modak.drmadhusudan.com";
    const returnUrl = `${origin}/thank-you?order_id={order_id}&amount=${chosen.amount}&pack=${pack || "monthly"}`;

    const orderPayload = {
      order_id: orderId,
      order_amount: chosen.amount,
      order_currency: "INR",
      customer_details: {
        customer_id: "cust_" + cleanPhone,
        customer_name: name || "Customer",
        customer_email: email || "customer@example.com",
        customer_phone: cleanPhone
      },
      order_meta: {
        return_url: returnUrl
      },
      order_note: chosen.label,
      order_tags: {
        pack: String(pack || "monthly")
      }
    };

    const cfRes = await fetch(`${BASE}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2023-08-01",
        "x-client-id": APP_ID,
        "x-client-secret": SECRET
      },
      body: JSON.stringify(orderPayload)
    });

    const data = await cfRes.json();

    if (!cfRes.ok || !data.payment_session_id) {
      return res.status(502).json({
        error: "Order creation failed",
        detail: data.message || "unknown"
      });
    }

    return res.status(200).json({
      payment_session_id: data.payment_session_id,
      order_id: orderId,
      env: ENV
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err.message || err) });
  }
};
