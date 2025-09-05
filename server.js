const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
app.use(express.json({ limit: '1mb' }));

// اسم نطاق نتليفي المسموح
const ALLOWED = new Set(['https://gleam-app-meker.netlify.app']);

// CORS: اسمح لنتليفي، وأيضًا للطلبات بدون Origin (APK/WebView)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin === 'null' || ALLOWED.has(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'), false);
  }
}));

// استخدم تخزين مؤقت على القرص (أفضل من الذاكرة على الخطة المجانية)
const upload = multer({
  dest: '/tmp/uploads',                   // مساحة مؤقتة
  limits: { fileSize: 50 * 1024 * 1024 }  // حد 50MB
});

// مسارات تجريبية
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

const items = [{ id: 1, title: 'Hello' }];
app.get('/api/items', (req, res) => res.json(items));
app.post('/api/items', (req, res) => {
  const item = { id: Date.now(), title: req.body?.title || '' };
  items.push(item);
  res.status(201).json(item);
});

// رفع ZIP: نقبل أي اسم حقل (file/zip/archive) باستعمال any()
app.post('/api/upload', upload.any(), (req, res) => {
  const f = (req.files && req.files[0]) || null;
  if (!f) return res.status(400).json({ ok: false, error: 'NO_FILE' });
  // هنا لاحقًا: أرسل الملف لخدمة التحويل/تخزين خارجي...
  res.json({ ok: true, filename: f.originalname, mimetype: f.mimetype, size: f.size });
});

// صفحة رئيسية
app.get('/', (req, res) => res.send('Backend OK'));

// معالج أخطاء موحّد (CORS/حجم الملف/أخرى) ليعيد JSON واضح
app.use((err, req, res, next) => {
  if (err && err.message === 'CORS blocked') {
    return res.status(403).json({ ok: false, error: 'CORS_BLOCKED' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'FILE_TOO_LARGE' });
  }
  console.error('ERROR:', err);
  return res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Listening on', PORT));
