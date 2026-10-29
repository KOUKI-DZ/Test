// Camera verification demo server. Node.js 20+; ExifTool must be installed.
// Secrets are environment variables; never commit your Telegram token to GitHub.
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PORT = Number(process.env.PORT || 3000);
// Preferred: set these as Render Environment Variables.
// If you specifically want to paste a test token into code, replace the placeholder below.
// WARNING: never commit a real token to a public GitHub repository.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7862488937:AAGl9mVu7vYsKWZLNxIyM9jiS9YAQNY3zN0';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7669414161';
const MAX_BODY = 9 * 1024 * 1024;
const PAGE_PATH = path.join(__dirname, 'public', 'index.html');

function json(res, status, data) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) {
        reject(new Error('حجم الطلب كبير جدًا؛ جرّب صورة أصغر.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error('تعذر قراءة الطلب.')); }
    });
    req.on('error', reject);
  });
}
function runExifTool(file) {
  return new Promise((resolve, reject) => {
    execFile('exiftool', ['-json', '-s', '-DateTimeOriginal', '-CreateDate', '-Make', '-Model', '-Software', '-ImageWidth', '-ImageHeight', '-GPSLatitude', '-GPSLongitude', '-GPSPosition', file],
      {timeout:12000, maxBuffer:256*1024}, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || 'تعذر تشغيل ExifTool. تحقق من تثبيته.'));
        try {
          const all = JSON.parse(stdout || '[]')[0] || {};
          const allowed = ['DateTimeOriginal','CreateDate','Make','Model','Software','ImageWidth','ImageHeight','GPSLatitude','GPSLongitude','GPSPosition'];
          const safe = {};
          for (const key of allowed) if (all[key] !== undefined) safe[key] = all[key];
          resolve(safe);
        } catch { reject(new Error('تعذر قراءة بيانات الصورة.')); }
      });
  });
}
async function sendTelegramPhoto(buffer, caption) {
  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('caption', caption.slice(0, 900));
  form.append('photo', new Blob([buffer], {type:'image/jpeg'}), 'camera-photo.jpg');
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {method:'POST', body:form});
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || 'فشل إرسال الصورة إلى Telegram.');
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, {ok:true});
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    try { const html = await fs.readFile(PAGE_PATH); res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'}); return res.end(html); }
    catch { res.writeHead(500); return res.end('لم يتم العثور على public/index.html'); }
  }
  if (req.method === 'POST' && url.pathname === '/api/send') {
    let tempFile;
    try {
      if (!BOT_TOKEN || !CHAT_ID) return json(res, 500, {error:'إعداد Telegram غير مكتمل على الخادم.'});
      const data = await readJson(req);
      if (data.consent !== true) return json(res, 400, {error:'الموافقة مطلوبة.'});
      if (typeof data.image !== 'string' || data.image.length < 100) return json(res, 400, {error:'لم تصل صورة صالحة.'});
      const buffer = Buffer.from(data.image, 'base64');
      if (!buffer.length || buffer.length > 6 * 1024 * 1024) return json(res, 413, {error:'حجم الصورة يجب أن يكون أقل من 6 ميغابايت.'});
      // Confirm JPEG signature before processing.
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return json(res, 400, {error:'صيغة الصورة غير مدعومة.'});
      tempFile = path.join(os.tmpdir(), `camera-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
      await fs.writeFile(tempFile, buffer, {flag:'wx'});
      let metadata = {};
      try { metadata = await runExifTool(tempFile); }
      catch (e) { metadata = {ExifToolWarning: e.message}; }
      const caption = 'صورة أرسلها المستخدم بموافقته\n\nالبيانات الوصفية المتاحة:\n' +
        (Object.keys(metadata).length ? Object.entries(metadata).map(([k,v]) => `${k}: ${String(v)}`).join('\n') : 'لا توجد بيانات EXIF مدعومة في الصورة.');
      await sendTelegramPhoto(buffer, caption);
      return json(res, 200, {ok:true});
    } catch (e) {
      return json(res, 500, {error:e.message || 'حدث خطأ أثناء معالجة الصورة.'});
    } finally {
      if (tempFile) await fs.rm(tempFile, {force:true}).catch(()=>{});
    }
  }
  res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); res.end('Not found');
});
server.listen(PORT, '0.0.0.0', () => console.log(`Camera demo running on port ${PORT}`));
