  // ثم إعادة المسار الناتج.
  // الآن: ننسخ الملف ونغيّر الامتداد ليعمل التدفق كاملًا.
  // --- Gleam backend: upload -> job -> status -> download ---
// يعمل على Render المجاني. لا يبني APK/EXE فعليًا الآن؛
// لكنه يجهز الهيكل (jobs) وينسخ الملف ويغيّر الامتداد للاختبار.
// لاحقًا استبدل runConversion() بالمحوّل الحقيقي لديك.

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

const app = express();

// ===== إعدادات =====
const ALLOWED_ORIGINS = new Set([
  process.env.ALLOWED_ORIGIN || 'https://gleam-app-meker.netlify.app'
]);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 50);
const TMP_DIR = process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'gleam');
const OUT_DIR = path.join(TMP_DIR, 'out');
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// ===== وسطيات =====
app.use(express.json({ limit: '2mb' }));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || origin === 'null' || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      return cb(new Error('CORS_BLOCKED'), false);
    }
  })
);

// رفع إلى /tmp + قبول zip فقط
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok =
      /(\.zip)$/i.test(file.originalname) ||
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed';
    if (!ok) return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  }
});

// ===== تخزين مؤقت في الذاكرة =====
const files = new Map(); // fileId -> { path, name, size, uploadedAt }
const jobs  = new Map(); // jobId  -> { status, target, fileId, outputPath?, outputName?, ... }

// ===== مسارات عامة =====
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now(), tmp: TMP_DIR }));
app.get('/', (req, res) => res.send('Backend OK'));

// رفع ZIP
app.post('/api/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'NO_FILE' });
    const fileId = randomUUID();
    files.set(fileId, {
      path: req.file.path,
      name: req.file.originalname,
      size: req.file.size,
      uploadedAt: Date.now()
    });
    res.json({ ok: true, fileId, filename: req.file.originalname, size: req.file.size });
  } catch (e) { next(e); }
});

// بدء التحويل
app.post('/api/convert', async (req, res, next) => {
  try {
    const { fileId, target } = req.body || {};
    if (!fileId) return res.status(400).json({ ok: false, error: 'NO_FILE_ID' });
    const tgt = String(target || 'apk').toLowerCase();
    if (!['apk', 'exe'].includes(tgt)) return res.status(400).json({ ok: false, error: 'BAD_TARGET' });

    const file = files.get(fileId);
    if (!file) return res.status(404).json({ ok: false, error: 'FILE_NOT_FOUND' });

    const jobId = randomUUID();
    jobs.set(jobId, { status: 'queued', target: tgt, fileId, createdAt: Date.now() });

    runConversion(jobId).catch(err => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'error';
        j.error = err?.message || String(err);
        j.doneAt = Date.now();
        jobs.set(jobId, j);
      }
    });

    res.json({ ok: true, jobId });
  } catch (e) { next(e); }
});

// حالة التحويل
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });
  res.json({
    ok: true,
    jobId: req.params.jobId,
    status: job.status,
    target: job.target,
    error: job.error || null,
    createdAt: job.createdAt,
    doneAt: job.doneAt || null,
    downloadUrl: job.status === 'done'
      ? `${req.protocol}://${req.get('host')}/api/download/${req.params.jobId}`
      : null
  });
});

// تنزيل الناتج
app.get('/api/download/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });
  if (job.status !== 'done') return res.status(409).json({ ok: false, error: 'NOT_READY' });
  res.download(job.outputPath, job.outputName || `output.${job.target}`);
});

// "التحويل" المبدئي (انسخه لاحقًا بمحركك الحقيقي)
async function runConversion(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('JOB_NOT_FOUND_INTERNAL');
  const file = files.get(job.fileId);
  if (!file) throw new Error('FILE_NOT_FOUND_INTERNAL');

  job.status = 'processing';
  jobs.set(jobId, job);

  const base = path.parse(file.name).name || 'app';
  const outName = `${base}.${job.target}`;
  const outPath = path.join(OUT_DIR, `${jobId}.${job.target}`);

  await sleep(800); // محاكاة زمن البناء
  await fsp.copyFile(file.path, outPath);

  job.status = 'done';
  job.outputName = outName;
  job.outputPath = outPath;
  job.doneAt = Date.now();
  jobs.set(jobId, job);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// أخطاء عامة
app.use((err, req, res, next) => {
  if (err?.message === 'CORS_BLOCKED') return res.status(403).json({ ok: false, error: 'CORS_BLOCKED' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: 'FILE_TOO_LARGE' });
  if (err?.message === 'UNSUPPORTED_TYPE') return res.status(415).json({ ok: false, error: 'UNSUPPORTED_TYPE' });
  console.error('ERROR:', err);
  res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Listening on', PORT));
