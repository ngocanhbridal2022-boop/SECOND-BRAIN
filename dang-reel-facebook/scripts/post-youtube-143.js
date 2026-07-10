#!/usr/bin/env node
/**
 * post-youtube-143.js — Đăng VIDEO lên YouTube TỪ CHÍNH bảng 14.3 (đăng bài tự động).
 *
 * Mục tiêu: 1 dòng video ở 14.3 tick "Đăng YouTube" → vừa lên Facebook (post-feed-api.js)
 *   vừa lên YouTube (file này). Không cần bảng 16.3 riêng nữa.
 *
 * Điều kiện đăng 1 dòng:
 *   - "Đăng YouTube" = tick (true)
 *   - có VIDEO trong "Ảnh/video"
 *   - đã tới giờ "Lịch đăng bài" (trống = đăng ngay)
 *   - "Link YouTube" còn TRỐNG (chưa đăng) → tránh đăng trùng
 *
 * Đăng xong: ghi "Link YouTube" + gộp {t:'yt'} vào "Ref (máy)" (để máy reach cộng lượt xem).
 *
 * Env: LARK_APP_ID (cli_aaaa968... — app đã có quyền 14.3), LARK_APP_SECRET, LARK_APP_TOKEN,
 *   YT_TABLE_ID (=14.3), YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_HEBE, YT_REFRESH_NGOCANH.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');

const E = process.env;
const DRY = process.argv.includes('--dry-run');
const DOMAIN = `https://open.${E.LARK_DOMAIN || 'larksuite'}.com`;
const APP_ID = E.LARK_APP_ID || 'cli_aaaa968ce1785e17';
const APP_SECRET = E.LARK_APP_SECRET || '';
const BASE = E.LARK_APP_TOKEN || 'J62zbhBhtaxrpMsaSzljllffpdh';
const TABLE = E.YT_TABLE_ID || 'tbla3Qc2n9uwCN0z';           // 14.3
const MAX_PER_RUN = parseInt(E.YT_MAX_PER_RUN || '5', 10);
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(now(), ...a);

const CHANNELS = { 'HEBE studio': E.YT_REFRESH_HEBE, 'Ngọc Ánh Makeup': E.YT_REFRESH_NGOCANH };
const DEFAULT_CHANNEL = 'HEBE studio';

if (!DRY && !APP_SECRET) { console.error('!! Thiếu LARK_APP_SECRET'); process.exit(1); }
if (!DRY && !E.YT_CLIENT_ID) { console.error('!! Thiếu YT_CLIENT_ID/SECRET/REFRESH — bỏ qua bước YouTube.'); process.exit(0); }

async function jfetch(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}
async function larkToken() {
  const r = await jfetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
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
function firstVideo(fields) {
  const a = fields['Ảnh/video'];
  if (!Array.isArray(a)) return null;
  for (const f of a) {
    const name = (f.name || '').toLowerCase(), type = (f.type || '').toLowerCase();
    if (type.startsWith('video') || /\.(mp4|mov|m4v|webm|avi|mkv)$/.test(name)) return f;
  }
  return null;
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
  if (!init.ok) { const t = await init.text(); const err = new Error('init ' + init.status + ': ' + t.slice(0, 250)); err.quota = /quota/i.test(t); throw err; }
  const loc = init.headers.get('location');
  if (!loc) throw new Error('YouTube không trả upload session');
  const put = await jfetch(loc, { method: 'PUT', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'video/*', 'Content-Length': String(size) }, body: fs.readFileSync(filePath) });
  const d = await put.json();
  if (!d.id) { const err = new Error('upload: ' + JSON.stringify(d).slice(0, 250)); err.quota = /quota/i.test(JSON.stringify(d)); throw err; }
  return { id: d.id, url: 'https://youtu.be/' + d.id };
}
// Tiêu đề = dòng đầu tiên có chữ của Nội dung, bỏ hashtag, tối đa 100 ký tự.
function makeTitle(content) {
  const line = (content || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
  const t = line.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
  return (t || 'Video').slice(0, 100);
}

(async () => {
  const tk = await larkToken();
  const rows = await listRows(tk);
  const nowMs = Date.now();
  const due = rows.filter(r => {
    const f = r.fields;
    const wantYT = f['Đăng YouTube'] === true;
    const notYet = !txt(f['Link YouTube']).trim();          // chưa có link YT
    const hasVid = !!firstVideo(f);
    const sched = f['Lịch đăng bài'];
    const timeOk = !sched || sched <= nowMs;
    return wantYT && notYet && hasVid && timeOk;
  }).sort((a, b) => (a.fields['Lịch đăng bài'] || 0) - (b.fields['Lịch đăng bài'] || 0)).slice(0, MAX_PER_RUN);

  if (!due.length) { log('YouTube: không có video nào cần đăng (tick "Đăng YouTube" + có video + đến giờ + chưa có link YT). Xong.'); return; }
  log(`YouTube: ${due.length} video cần đăng${DRY ? ' (DRY-RUN)' : ''}.`);

  let posted = 0, failed = 0;
  for (const r of due) {
    const f = r.fields;
    const channel = txt(f['Kênh YouTube']).trim() || DEFAULT_CHANNEL;
    const refresh = CHANNELS[channel];
    const content = txt(f['Nội dung']);
    const title = makeTitle(content);
    let desc = content;
    if (!/#shorts/i.test(desc)) desc = (desc + '\n\n#Shorts').trim();   // mặc định Shorts (video dọc ngắn)
    const vid = firstVideo(f);

    if (!refresh) { log(`  ✗ "${title}": kênh "${channel}" chưa có refresh token`); failed++; continue; }
    log(`  ▶ "${title}" | kênh: ${channel}`);
    if (DRY) { posted++; continue; }

    let videoPath;
    try {
      videoPath = await downloadVideo(tk, vid.file_token, vid.name);
      const access = await accessToken(refresh);
      const meta = { snippet: { title, description: desc.slice(0, 4900), categoryId: '22' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } };
      const res = await uploadVideo(access, videoPath, meta);
      // gộp Ref (máy): giữ ref FB, thêm/thay ref YT
      let refs = []; try { refs = JSON.parse(txt(f['Ref (máy)']) || '[]'); if (!Array.isArray(refs)) refs = []; } catch {}
      refs = refs.filter(x => x && x.t !== 'yt').concat([{ t: 'yt', vid: res.id, link: res.url }]);
      await updateRow(tk, r.record_id, { 'Link YouTube': { link: res.url, text: 'Xem YouTube' }, 'Ref (máy)': JSON.stringify(refs) });
      log(`    ✔ ĐÃ ĐĂNG YT: ${res.url}`);
      posted++;
    } catch (e) {
      log(`    ✗ LỖI YT: ${e.message}`);
      failed++;
      if (e.quota) { log('    ⛔ Chạm quota YouTube — dừng, để dành lượt sau.'); break; }
    } finally {
      if (videoPath) { try { fs.unlinkSync(videoPath); } catch {} }
    }
  }
  log(`YouTube xong. Đăng: ${posted}, Lỗi: ${failed}.`);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
