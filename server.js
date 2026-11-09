const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const EA_API_KEY = process.env.EA_API_KEY;

if (!DASHBOARD_PASSWORD  !SESSION_SECRET  !EA_API_KEY) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

const settingsFile = path.join(__dirname, "settings.json");

let settings = {
  lotSize: 0.01,
  maxPositions: 5,
  combinedTP: 10,
  combinedSL: 10,
  mt5Login: "",
  brokerServer: ""
};

if (fs.existsSync(settingsFile)) {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };
  } catch {
    console.error("Could not read settings.json. Using defaults.");
  }
}

let botEnabled = false;
let closeAllRequested = false;
let lastEAContact = 0;
let eaAccount = { login: "", server: "" };

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function makeSession() {
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  const payload = String(expires);
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");

  return ${payload}.${signature};
}

function validSession(req) {
  const token = req.headers.cookie
    ?.split("; ")
    .find(item => item.startsWith("xau_session="))
    ?.split("=")[1];

  if (!token) return false;

  const [expires, signature] = token.split(".");
  if (!expires  !signature  Number(expires) < Date.now()) return false;

  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(expires)
    .digest("hex");

  return safeEqual(signature, expected);
}

function requireDashboard(req, res, next) {
  if (!validSession(req)) {
    return res.status(401).json({ error: "Please log in." });
  }
  next();
}

function requireEA(req, res, next) {
  if (!safeEqual(req.headers["x-ea-key"] || "", EA_API_KEY)) {
    return res.status(401).json({ error: "EA authentication failed." });
  }
  next();
}

app.post("/api/login", (req, res) => {
  if (!safeEqual(req.body.password || "", DASHBOARD_PASSWORD)) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  const session = makeSession();
  res.setHeader(
    "Set-Cookie",
    xau_session=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200
  );

  res.json({ success: true });
});

app.post("/api/logout", requireDashboard, (req, res) => {
  res.setHeader(
    "Set-Cookie",
    "xau_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
  );
  res.json({ success: true });
});

app.get("/api/dashboard", requireDashboard, (req, res) => {
  res.json({
    settings,
    botEnabled,
    eaConnected: Date.now() - lastEAContact < 20000,
    eaAccount
  });
});

app.post("/api/settings", requireDashboard, (req, res) => {
  const body = req.body;

  const lotSize = Number(body.lotSize);
  const maxPositions = Number(body.maxPositions);
  const combinedTP = Number(body.combinedTP);
  const combinedSL = Number(body.combinedSL);

  if (
    !Number.isFinite(lotSize)  lotSize <= 0 
    !Number.isInteger(maxPositions)  maxPositions < 1 
    !Number.isFinite(combinedTP)  combinedTP < 0 
    !Number.isFinite(combinedSL) || combinedSL < 0
  ) {
    return res.status(400).json({ error: "Invalid settings." });
  }

  settings = {
    ...settings,
    lotSize,
    maxPositions,
    combinedTP,
    combinedSL,
    mt5Login: String(body.mt5Login || "").slice(0, 40),
    brokerServer: String(body.brokerServer || "").slice(0, 100)
  };

  try {
    saveSettings();
    res.json({ success: true, settings });
  } catch {
    res.status(500).json({ error: "Could not save settings." });
  }
});

app.post("/api/control", requireDashboard, (req, res) => {
  const action = req.body.action;

  if (action === "start") {
    botEnabled = true;
  } else if (action === "stop") {
    botEnabled = false;
    closeAllRequested = true;
  } else {
    return res.status(400).json({ error: "Invalid control action." });
  }

  res.json({ success: true, botEnabled, closeAllRequested });
});

app.post("/api/ea/poll", requireEA, (req, res) => {
  lastEAContact = Date.now();

  if (req.body.login !== undefined) {
    eaAccount.login = String(req.body.login).slice(0, 40);
  }

  if (req.body.server !== undefined) {
    eaAccount.server = String(req.body.server).slice(0, 100);
  }

  if (req.body.closeAllDone === true) {
    closeAllRequested = false;
  }

  res.json({
    settings,
    botEnabled,
    closeAllRequested
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    name: "XAU TICK STRIKER",
    status: "online"
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(XAU TICK STRIKER server running on port ${PORT});
});

         
