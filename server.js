const express = require("express");
const cors = require("cors");
const app = express();

app.use(express.json({ limit: "1mb" }));

// اسمح لواجهة نتليفي + طلبات بدون Origin (WebView/curl)
const ALLOWED = new Set(["https://gleam-app-meker.netlify.app"]);
app.use(cors({
  origin: (o, cb) => (!o || o === "null" || ALLOWED.has(o))
    ? cb(null, true)
    : cb(new Error("CORS blocked"), false)
}));

app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

const items = [{ id: 1, title: "Hello" }];
app.get("/api/items", (req, res) => res.json(items));
app.post("/api/items", (req, res) => {
  const item = { id: Date.now(), title: req.body?.title || "" };
  items.push(item);
  res.status(201).json(item);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Listening on", PORT));
