const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
app.use(express.json({ limit: '1mb' }));

// السماح لواجهة نتليفي + السماح لطلبات بدون Origin (ملف APK/WebView)
const ALLOWED = new Set(['https://gleam-app-meker.netlify.app']);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin === 'null' || ALLOWED.has(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'), false);
  }
}));

// رفع ZIP حتى 30MB في الذاكرة (تجريبي)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

// صحة
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// بيانات تجريبية
const items = [{ id: 1, title: 'Hello' }];
app.get('/api/items', (req, res) => res.json(items));
app.post('/api/items', (req, res) => {
  const item = { id: Date.now(), title: req.body?.title || '' };
  items.push(item);
  res.status(201).json(item);
});

// رفع ZIP — الحقل اسمه "file"
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  res.json({
    ok: true,
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
});

// صفحة رئيسية بسيطة
app.get('/', (req, res) => res.send('Backend OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Listening on', PORT));
