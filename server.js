const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const PASSWORD = process.env.DASHBOARD_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const EA_API_KEY = process.env.EA_API_KEY;

if (!PASSWORD) {
  console.error("Missing DASHBOARD_PASSWORD");
  process.exit(1);
}

if (!SESSION_SECRET) {
  console.error("Missing SESSION_SECRET");
  process.exit(1);
}

if (!EA_API_KEY) {
  console.error("Missing EA_API_KEY");
  process.exit(1);
}

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

const settingsFile = path.join(__dirname, "settings.json");

let settings = {
  lotSize: 0.01,
  maxPositions: 5,
  combinedTP: 10,
  combinedSL: 10,
  mt5Login: "",
  brokerServer: ""
};

try {
  if (fs.existsSync(settingsFile)) {
    settings = Object.assign(
      settings,
      JSON.parse(fs.readFileSync(settingsFile, "utf8"))
    );
  }
} catch (error) {
  console.error("Settings file could not be loaded.");
}

let botEnabled = false;
let closeAllRequested = false;
let lastEAContact = 0;

let eaAccount = {
  login: "",
  server: ""
};

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function makeSession() {
  const expires = String(Date.now() + 43200000);

  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(expires)
    .digest("hex");

  return expires + "." + signature;
}

function validSession(req) {
  const cookies = req.headers.cookie || "";

  const token = cookies
    .split(";")
    .map(function (item) {
      return item.trim();
    })
    .find(function (item) {
      return item.indexOf("xau_session=") === 0;
    });

  if (!token) return false;

  const parts = token.substring("xau_session=".length).split(".");

  const expires = parts[0];
  const signature = parts[1];

  if (!expires) return false;
if (!signature) return false;
if (Number(expires) < Date.now()) return false;


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

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

app.post("/api/login", function (req, res) {
  if (!safeEqual(req.body.password || "", PASSWORD)) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  const session = makeSession();

  res.setHeader(
    "Set-Cookie",
    "xau_session=" + session +
    "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200"
  );

  res.json({ success: true });
});

app.post("/api/logout", requireDashboard, function (req, res) {
  res.setHeader(
    "Set-Cookie",
    "xau_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
  );

  res.json({ success: true });
});

app.get("/api/dashboard", requireDashboard, function (req, res) {
  res.json({
    settings: settings,
    botEnabled: botEnabled,
    eaConnected: Date.now() - lastEAContact < 20000,
    eaAccount: eaAccount
  });
});

app.post("/api/settings", requireDashboard, function (req, res) {
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

  settings = Object.assign({}, settings, {
    lotSize: lotSize,
    maxPositions: maxPositions,
    combinedTP: combinedTP,
    combinedSL: combinedSL,
    mt5Login: String(body.mt5Login || "").slice(0, 40),
    brokerServer: String(body.brokerServer || "").slice(0, 100)
  });

  try {
    saveSettings();
    res.json({ success: true, settings: settings });
  } catch (error) {
    res.status(500).json({ error: "Could not save settings." });
  }
});

app.post("/api/control", requireDashboard, function (req, res) {
  const action = req.body.action;

  if (action === "start") {
    botEnabled = true;
  } else if (action === "stop") {
    botEnabled = false;
    closeAllRequested = true;
  } else {
    return res.status(400).json({ error: "Invalid control action." });
  }

  res.json({
    success: true,
    botEnabled: botEnabled,
    closeAllRequested: closeAllRequested
  });
});

app.post("/api/ea/poll", requireEA, function (req, res) {
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
    settings: settings,
    botEnabled: botEnabled,
    closeAllRequested: closeAllRequested
  });
});

app.get("/api/health", function (req, res) {
  res.json({
    name: "XAU TICK STRIKER",
    status: "online"
  });
});

app.get("/", function (req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", function () {
  console.log("XAU TICK STRIKER server running on port " + PORT);
});
