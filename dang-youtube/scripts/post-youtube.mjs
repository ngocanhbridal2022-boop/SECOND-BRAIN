#!/usr/bin/env node
/**
 * post-youtube.mjs — Máy ĐĂNG VIDEO YOUTUBE hẹn giờ từ Lark Base (chạy trên GitHub Actions).
 *
 * Luồng: quét bảng "Lịch đăng YouTube" -> dòng Trạng thái "Chờ đăng" đã đến giờ
 *   -> tải video từ Lark -> upload YouTube Data API v3 (resumable) đúng kênh
 *   -> ghi Link + Trạng thái "Đã đăng" ngược lại bảng.
 *
 * Biến môi trường:
 *   LARK_APP_ID, LARK_APP_SECRET, LARK_APP_TOKEN, YT_TABLE_ID  (Lark)
 *   YT_CLIENT_ID, YT_CLIENT_SECRET                              (OAuth client)
 *   YT_REFRESH_HEBE, YT_REFRESH_NGOCANH                         (refresh token mỗi kênh)
 * Chạy:  node post-youtube.mjs           (đăng thật)
 *        node post-youtube.mjs --dry-run (chỉ liệt kê)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const E = process.env;
const DRY = process.argv.includes('--dry-run');
const DOMAIN = `https://open.${E.LARK_DOMAIN || 'larksuite'}.com`;
const BASE = E.LARK_APP_TOKEN || 'J62zbhBhtaxrpMsaSzljllffpdh';
const TABLE = E.YT_TABLE_ID;
const MAX_PER_RUN = parseInt(E.YT_MAX_PER_RUN || '5', 10); // giữ dưới quota (1 upload = 1600, hạn 10000/ngày)
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(now(), ...a);

// map tên kênh -> refresh token
const CHANNELS = {
  'HEBE studio': E.YT_REFRESH_HEBE,
  'Ngọc Ánh Makeup': E.YT_REFRESH_NGOCANH,
};
const PRIVACY = { 'Công khai': 'public', 'Không công khai': 'unlisted', 'Riêng tư': 'private' };

async function jfetch(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}

// ---------- Lark ----------
async function larkToken() {
  const r = await jfetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: E.LARK_APP_ID || 'cli_aaaa968ce1785e17', app_secret: E.LARK_APP_SECRET }),
  });
  const d = await r.json();
  if (d.code !== 0) throw new Error('Lark token: ' + JSON.stringify(d));
  return d.tenant_access_token;
}
async function listRows(tk) {
  const out = []; let pt = '';
  do {
    const r = await jfetch(`${DOMAIN}/open-apis/bitable/v1/apps/${BASE}/tables/${TABLE}/records?page_size=200${pt ? '&page_token=' + pt : ''}`,
      { headers: { Authorization: 'Bearer ' + tk } });
    const d = await r.json();
    if (d.code !== 0) throw new Error('list: ' + JSON.stringify(d));
    out.push(...(d.data.items || [])); pt = d.data.has_more ? d.data.page_token : '';
  } while (pt);
  return out;
}
function txt(v) {
  if (Array.isArray(v)) return v.map(x => (x && x.text) || (x && x.name) || (typeof x === 'string' ? x : '')).join(' ').trim();
  if (v && typeof v === 'object') return v.text || v.name || '';
  return v == null ? '' : String(v);
}
async function updateRow(tk, recId, fields) {
  const r = await jfetch(`${DOMAIN}/open-apis/bitable/v1/apps/${BASE}/tables/${TABLE}/records/${recId}`, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  const d = await r.json();
  if (d.code !== 0) log('  ! ghi Base lỗi:', JSON.stringify(d).slice(0, 200));
}
async function downloadVideo(tk, fileToken, name) {
  const extra = encodeURIComponent(JSON.stringify({ bitablePerm: { tableId: TABLE } }));
  const r = await jfetch(`${DOMAIN}/open-apis/drive/v1/medias/${fileToken}/download?extra=${extra}`,
    { headers: { Authorization: 'Bearer ' + tk } });
  if (!r.ok) throw new Error('tải video HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const p = path.join(os.tmpdir(), `yt-${fileToken.slice(0, 10)}${path.extname(name || '') || '.mp4'}`);
  fs.writeFileSync(p, buf);
  return p;
}

// ---------- YouTube ----------
async function accessToken(refresh) {
  const body = new URLSearchParams({ client_id: E.YT_CLIENT_ID, client_secret: E.YT_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' });
  const r = await jfetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const d = await r.json();
  if (!d.access_token) throw new Error('OAuth: ' + JSON.stringify(d).slice(0, 200));
  return d.access_token;
}
async function uploadVideo(access, filePath, meta) {
  const size = fs.statSync(filePath).size;
  const init = await jfetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/*' },
    body: JSON.stringify(meta),
  });
  if (!init.ok) { const t = await init.text(); const err = new Error('init upload ' + init.status + ': ' + t.slice(0, 300)); err.quota = /quota/i.test(t); throw err; }
  const loc = init.headers.get('location');
  if (!loc) throw new Error('YouTube không trả upload session');
  const put = await jfetch(loc, { method: 'PUT', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'video/*', 'Content-Length': String(size) }, body: fs.readFileSync(filePath) });
  const d = await put.json();
  if (!d.id) { const err = new Error('upload: ' + JSON.stringify(d).slice(0, 300)); err.quota = /quota/i.test(JSON.stringify(d)); throw err; }
  return { id: d.id, url: 'https://youtu.be/' + d.id };
}

// ---------- main ----------
(async () => {
  if (!TABLE) { console.error('!! Thiếu YT_TABLE_ID'); process.exit(1); }
  const tk = await larkToken();
  const rows = await listRows(tk);
  const nowMs = Date.now();
  const due = rows.filter(r => {
    const f = r.fields;
    const st = txt(f['Trạng thái']).trim();
    const hasVid = Array.isArray(f['Video']) && f['Video'].length > 0;
    const sched = f['Ngày giờ đăng'];
    const timeOk = !sched || sched <= nowMs;   // trống = đăng ngay
    return st === 'Chờ đăng' && hasVid && timeOk;
  }).sort((a, b) => (a.fields['Ngày giờ đăng'] || 0) - (b.fields['Ngày giờ đăng'] || 0)).slice(0, MAX_PER_RUN);

  if (!due.length) { log('Không có video nào đến hạn đăng. Xong.'); return; }
  log(`Có ${due.length} video đến hạn${DRY ? ' (DRY-RUN, không đăng thật)' : ''}.`);

  let posted = 0, failed = 0;
  for (const r of due) {
    const f = r.fields;
    const title = txt(f['Tiêu đề']).slice(0, 100) || 'Video';
    const channel = txt(f['Kênh']).trim();
    const refresh = CHANNELS[channel];
    const vid = f['Video'][0];
    const isShorts = txt(f['Loại']).includes('Shorts');
    let desc = txt(f['Mô tả']);
    if (isShorts && !/#shorts/i.test(desc)) desc = (desc + '\n\n#Shorts').trim();
    const tags = txt(f['Tags']).split(',').map(s => s.trim()).filter(Boolean).slice(0, 15);
    const privacy = PRIVACY[txt(f['Chế độ']).trim()] || 'public';

    if (!refresh) { log(`  ✗ ${title}: kênh "${channel}" chưa có token — bỏ qua`); if (!DRY) await updateRow(tk, r.record_id, { 'Trạng thái': 'Lỗi', 'Ghi chú lỗi': `Kênh "${channel}" chưa cấu hình token` }); failed++; continue; }

    log(`  ▶ ${title} | kênh: ${channel} | ${isShorts ? 'Shorts' : 'Video dài'} | ${privacy}`);
    if (DRY) { posted++; continue; }

    await updateRow(tk, r.record_id, { 'Trạng thái': 'Đang đăng' });
    let videoPath;
    try {
      videoPath = await downloadVideo(tk, vid.file_token, vid.name);
      const access = await accessToken(refresh);
      const meta = { snippet: { title, description: desc, tags, categoryId: '22' }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };
      const res = await uploadVideo(access, videoPath, meta);
      await updateRow(tk, r.record_id, { 'Trạng thái': 'Đã đăng', 'Link video': res.url, 'Ghi chú lỗi': '' });
      log(`    ✔ ĐÃ ĐĂNG: ${res.url}`);
      posted++;
    } catch (e) {
      log(`    ✗ LỖI: ${e.message}`);
      await updateRow(tk, r.record_id, { 'Trạng thái': 'Lỗi', 'Ghi chú lỗi': e.message.slice(0, 300) });
      failed++;
      if (e.quota) { log('    ⛔ Chạm quota YouTube — dừng, để dành lượt sau.'); break; }
    } finally {
      if (videoPath) { try { fs.unlinkSync(videoPath); } catch {} }
    }
  }
  log(`Xong. Đăng: ${posted}, Lỗi: ${failed}.`);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
