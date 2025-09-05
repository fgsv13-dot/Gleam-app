const express = require("express");
const cors = require("cors");
+const multer = require("multer");                // جديد
+const upload = multer({
+  storage: multer.memoryStorage(),
+  limits: { fileSize: 30 * 1024 * 1024 }         // 30MB
+});

const app = express();
app.use(express.json({ limit: "1mb" }));

const ALLOWED = new Set(["https://gleam-app-meker.netlify.app"]);
app.use(cors({
  origin: (o, cb) => (!o || o === "null" || ALLOWED.has(o))
    ? cb(null, true)
    : cb(new Error("CORS blocked"), false)
}));

// صحة
app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

// بيانات تجريبية
const items = [{ id: 1, title: "Hello" }];
app.get("/api/items", (req, res) => res.json(items));
app.post("/api/items", (req, res) => {
  const item = { id: Date.now(), title: req.body?.title || "" };
  items.push(item);
  res.status(201).json(item);
});

+// رفع ملف ZIP — الحقل اسمه "file"
+app.post("/api/upload", upload.single("file"), async (req, res) => {
+  if (!req.file) return res.status(400).json({ ok: false, error: "No file" });
+  // هنا يمكنك لاحقًا: إرسال الملف إلى تخزين خارجي/عامل بناء… إلخ.
+  // حاليًا نرجّع معلومات الملف فقط كتأكيد.
+  res.json({
+    ok: true,
+    filename: req.file.originalname,
+    mimetype: req.file.mimetype,
+    size: req.file.size
+  });
+});

+// (اختياري) رسالة للصفحة الرئيسية
+app.get("/", (req, res) => res.send("Backend OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Listening on", PORT));
