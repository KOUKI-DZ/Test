const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "7862488937:AAGl9mVu7vYsKWZLNxIyM9jiS9YAQNY3zN0";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "7669414161";
const MAX_BYTES = 8 * 1024 * 1024;
const INDEX = path.join(__dirname, 'index.html');

function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function parseMultipart(buffer, boundary) {
  const parts = [];
  const delimiter = Buffer.from('--' + boundary);
  let pos = 0;
  while ((pos = buffer.indexOf(delimiter, pos)) !== -1) {
    pos += delimiter.length;
    if (buffer.subarray(pos, pos + 2).equals(Buffer.from('--'))) break;
    if (buffer.subarray(pos, pos + 2).equals(Buffer.from('\r\n'))) pos += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headers = buffer.subarray(pos, headerEnd).toString('utf8');
    const next = buffer.indexOf(delimiter, headerEnd + 4);
    if (next === -1) break;
    let dataEnd = next;
    if (buffer.subarray(dataEnd - 2, dataEnd).equals(Buffer.from('\r\n'))) dataEnd -= 2;
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i);
    const name = disposition && disposition[1].match(/name="([^"]+)"/i)?.[1];
    const filename = disposition && disposition[1].match(/filename="([^"]*)"/i)?.[1];
    const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'application/octet-stream';
    if (name) parts.push({name, filename, contentType, data: buffer.subarray(headerEnd + 4, dataEnd)});
    pos = next;
  }
  return parts;
}
async function handleSend(req, res) {
  if (!TOKEN || !CHAT_ID) return send(res, 503, {ok:false,error:'الخادم غير مهيأ بعد: أضف TELEGRAM_BOT_TOKEN وTELEGRAM_CHAT_ID في إعدادات Render.'});
  const contentType = req.headers['content-type'] || '';
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundary) return send(res, 400, {ok:false,error:'صيغة الطلب غير صحيحة.'});
  const chunks=[]; let total=0;
  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_BYTES) { send(res, 413, {ok:false,error:'حجم الصورة أكبر من الحد المسموح (8 ميغابايت).'}); req.destroy(); return; }
      chunks.push(chunk);
    }
    const parts=parseMultipart(Buffer.concat(chunks), boundary[1] || boundary[2]);
    const consent=parts.find(p=>p.name==='consent')?.data.toString('utf8');
    const photo=parts.find(p=>p.name==='photo');
    if (consent !== 'yes') return send(res, 403, {ok:false,error:'لم يتم تأكيد الموافقة على الإرسال.'});
    if (!photo || !photo.data.length || !/^image\/(jpeg|png|webp)$/i.test(photo.contentType)) return send(res, 400, {ok:false,error:'لم يتم استلام صورة صالحة.'});
    const form=new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('caption','صورة تحقق أرسلها المستخدم بعد موافقته الصريحة.');
    const ext=photo.contentType.toLowerCase().includes('png')?'png':photo.contentType.toLowerCase().includes('webp')?'webp':'jpg';
    form.append('photo', new Blob([photo.data], {type:photo.contentType}), 'photo-check.'+ext);
    const telegram=await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`,{method:'POST',body:form});
    const result=await telegram.json().catch(()=>({ok:false}));
    if (!telegram.ok || !result.ok) {
      console.error('Telegram sendPhoto failed:', result.description || telegram.status);
      return send(res, 502, {ok:false,error:'لم يقبل تيليجرام الصورة. راجع إعدادات البوت ومعرّف المحادثة.'});
    }
    return send(res, 200, {ok:true});
  } catch (err) {
    console.error('Request failed:', err.message);
    if (!res.headersSent) send(res, 500, {ok:false,error:'حدث خطأ أثناء معالجة الطلب.'});
  }
}
const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host || 'localhost'}`);
  if (req.method==='GET' && (url.pathname==='/' || url.pathname==='/index.html')) {
    fs.readFile(INDEX,(err,data)=>err?send(res,500,{ok:false,error:'ملف index.html غير موجود.'}):send(res,200,data.toString('utf8'),'text/html; charset=utf-8'));
    return;
  }
  if (req.method==='POST' && url.pathname==='/api/send') return handleSend(req,res);
  if (req.method==='GET' && url.pathname==='/health') return send(res,200,{ok:true});
  send(res,404,{ok:false,error:'المسار غير موجود.'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Photo Check server listening on ${PORT}`));
