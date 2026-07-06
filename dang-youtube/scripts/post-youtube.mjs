#!/usr/bin/env node
/**
 * post-youtube.mjs — Máy ĐĂNG VIDEO YOUTUBE từ bảng 14.3 "Đăng bài tự động" (GitHub Actions).
 *
 * Đăng đa kênh từ 1 bảng: dòng nào TICK "Đăng YouTube" + có VIDEO + đến giờ (Lịch đăng bài)
 *   -> tải video từ Lark -> upload YouTube Data API v3 (resumable) đúng "Kênh YouTube"
 *   -> ghi "Link YouTube" + "TT YouTube" = Đã đăng.
 *
 * Secrets/vars: LARK_APP_SECRET, LARK_APP_TOKEN, YT_TABLE_ID,
 *   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_HEBE, YT_REFRESH_NGOCANH
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const E = process.env;
const DRY = process.argv.includes('--dry-run');
const DOMAIN = `https://open.${E.LARK_DOMAIN || 'larksuite'}.com`;
const BASE = E.LARK_APP_TOKEN || 'J62zbhBhtaxrpMsaSzljllffpdh';
const TABLE = E.YT_TABLE_ID || 'tbla3Qc2n9uwCN0z';
const MAX_PER_RUN = parseInt(E.YT_MAX_PER_RUN || '5', 10);
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(now(), ...a);

const CHANNELS = { 'HEBE studio': E.YT_REFRESH_HEBE, 'Ngọc Ánh Makeup': E.YT_REFRESH_NGOCANH };

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
  if (!init.ok) { const t = await init.text(); const err = new Error('init ' + init.status + ': ' + t.slice(0, 250)); err.quota = /quota/i.test(t); throw err; }
  const loc = init.headers.get('location');
  if (!loc) throw new Error('YouTube không trả upload session');
  const put = await jfetch(loc, { method: 'PUT', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'video/*', 'Content-Length': String(size) }, body: fs.readFileSync(filePath) });
  const d = await put.json();
  if (!d.id) { const err = new Error('upload: ' + JSON.stringify(d).slice(0, 250)); err.quota = /quota/i.test(JSON.stringify(d)); throw err; }
  return { id: d.id, url: 'https://youtu.be/' + d.id };
}
// ---------- main ----------
(async () => {
  const tk = await larkToken();
  const rows = await listRows(tk);
  const nowMs = Date.now();
  const due = rows.filter(r => {
    const f = r.fields;
    const on = f['Đăng YouTube'] === true;
    const hasVid = !!firstVideo(f);
    const doneOrErr = ['Đã đăng'].includes(txt(f['TT YouTube']).trim());
    const sched = f['Lịch đăng bài'];
    const timeOk = !sched || sched <= nowMs;
    return on && hasVid && !doneOrErr && timeOk;
  }).sort((a, b) => (a.fields['Lịch đăng bài'] || 0) - (b.fields['Lịch đăng bài'] || 0)).slice(0, MAX_PER_RUN);

  if (!due.length) { log('Không có video YouTube nào đến hạn (tick "Đăng YouTube" + có video + đến giờ). Xong.'); return; }
  log(`Có ${due.length} video cần đăng YouTube${DRY ? ' (DRY-RUN)' : ''}.`);

  let posted = 0, failed = 0;
  for (const r of due) {
    const f = r.fields;
    const channel = txt(f['Kênh YouTube']).trim();
    const refresh = CHANNELS[channel];
    const noidung = txt(f['Nội dung']);
    let title = txt(f['Tiêu đề YT']).trim() || noidung.split('\n')[0].slice(0, 100) || 'Video';
    title = title.slice(0, 100);
    const isShorts = txt(f['Loại YT']).includes('Shorts') || (!txt(f['Loại YT']) && true); // mặc định Shorts
    let desc = noidung;
    if (isShorts && !/#shorts/i.test(desc)) desc = (desc + '\n\n#Shorts').trim();
    const vid = firstVideo(f);

    if (!channel) { log(`  ✗ ${title}: chưa chọn "Kênh YouTube" — bỏ qua`); continue; }
    if (!refresh) { log(`  ✗ ${title}: kênh "${channel}" chưa có token`); if (!DRY) await updateRow(tk, r.record_id, { 'TT YouTube': 'Lỗi', 'Log YouTube': `Kênh "${channel}" chưa cấu hình` }); failed++; continue; }

    log(`  ▶ ${title} | kênh: ${channel} | ${isShorts ? 'Shorts' : 'Video dài'}`);
    if (DRY) { posted++; continue; }

    let videoPath;
    try {
      videoPath = await downloadVideo(tk, vid.file_token, vid.name);
      const access = await accessToken(refresh);
      const meta = { snippet: { title, description: desc, categoryId: '22' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } };
      const res = await uploadVideo(access, videoPath, meta);
      await updateRow(tk, r.record_id, { 'TT YouTube': 'Đã đăng', 'Link YouTube': res.url, 'Log YouTube': '' });
      log(`    ✔ ĐÃ ĐĂNG: ${res.url}`);
      posted++;
    } catch (e) {
      log(`    ✗ LỖI: ${e.message}`);
      await updateRow(tk, r.record_id, { 'TT YouTube': 'Lỗi', 'Log YouTube': e.message.slice(0, 300) });
      failed++;
      if (e.quota) { log('    ⛔ Chạm quota YouTube — dừng, để dành lượt sau.'); break; }
    } finally {
      if (videoPath) { try { fs.unlinkSync(videoPath); } catch {} }
    }
  }
  log(`Xong. Đăng: ${posted}, Lỗi: ${failed}.`);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
