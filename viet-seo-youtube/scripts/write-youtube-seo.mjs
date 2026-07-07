#!/usr/bin/env node
/**
 * write-youtube-seo.mjs — Máy VIẾT NỘI DUNG CHUẨN SEO YOUTUBE cho bảng 16.3.
 *
 * Luồng: quét bảng 16.3 -> dòng CÓ Video nhưng "Mô tả" còn TRỐNG (chưa viết)
 *   -> tải video từ Lark -> ffmpeg lấy vài khung hình + tách tiếng nói (Whisper)
 *   -> Claude "xem" (khung hình) + "nghe" (transcript) rồi viết Tiêu đề + Mô tả + Tags chuẩn SEO
 *   -> ghi ngược vào bảng. KHÔNG đụng Trạng thái / Ngày giờ đăng (để cô duyệt + đặt giờ).
 *
 * Máy đăng (post-youtube.mjs) lo phần đăng khi cô đặt "Chờ đăng" + giờ.
 *
 * Env: YT_LARK_APP_ID, YT_LARK_APP_SECRET (app HEBE STUDIO — admin, vào được 16.3),
 *   LARK_APP_TOKEN, YT_TABLE_ID, ANTHROPIC_API_KEY, OPENAI_API_KEY (Whisper),
 *   (tùy chọn) YT_SEO_MODEL, YT_SEO_MAX_PER_RUN
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const E = process.env;
const DRY = process.argv.includes('--dry-run');
const DOMAIN = `https://open.${E.LARK_DOMAIN || 'larksuite'}.com`;
const BASE = E.LARK_APP_TOKEN || 'J62zbhBhtaxrpMsaSzljllffpdh';
const TABLE = E.YT_TABLE_ID;
const MODEL = E.YT_SEO_MODEL || 'claude-opus-4-8';
const MAX_PER_RUN = parseInt(E.YT_SEO_MAX_PER_RUN || '3', 10);
const MAX_FRAMES = 6;
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(now(), ...a);

// Ngữ cảnh thương hiệu theo kênh (để viết SEO đúng chất)
const BRAND = {
  'HEBE studio': 'Kênh chuyên váy cưới & dịch vụ cưới cao cấp (Hebe Studio). Đối tượng: cô dâu sắp cưới, người đi thử/thuê/may váy cưới, chú rể. Giọng: sang trọng, tinh tế, truyền cảm hứng.',
  'Ngọc Ánh Makeup': 'Kênh chuyên trang điểm cô dâu & làm đẹp (Ngọc Ánh Makeup). Đối tượng: cô dâu, người mê makeup, học viên trang điểm. Giọng: gần gũi, chuyên nghiệp, chia sẻ bí quyết.',
};

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
    body: JSON.stringify({ app_id: E.YT_LARK_APP_ID, app_secret: E.YT_LARK_APP_SECRET }),
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
  const a = fields['Video'];
  if (!Array.isArray(a)) return null;
  for (const f of a) {
    const name = (f.name || '').toLowerCase(), type = (f.type || '').toLowerCase();
    if (type.startsWith('video') || /\.(mp4|mov|m4v|webm|avi|mkv)$/.test(name)) return f;
  }
  return a[0] || null;
}
async function updateRow(tk, recId, fields) {
  const r = await jfetch(`${DOMAIN}/open-apis/bitable/v1/apps/${BASE}/tables/${TABLE}/records/${recId}`, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  const d = await r.json();
  if (d.code !== 0) { log('  ! ghi Base lỗi:', JSON.stringify(d).slice(0, 200)); return false; }
  return true;
}
async function downloadVideo(tk, fileToken, name) {
  const extra = encodeURIComponent(JSON.stringify({ bitablePerm: { tableId: TABLE } }));
  const r = await jfetch(`${DOMAIN}/open-apis/drive/v1/medias/${fileToken}/download?extra=${extra}`,
    { headers: { Authorization: 'Bearer ' + tk } });
  if (!r.ok) throw new Error('tải video HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const p = path.join(os.tmpdir(), `seo-${fileToken.slice(0, 10)}${path.extname(name || '') || '.mp4'}`);
  fs.writeFileSync(p, buf);
  return p;
}
// ---------- ffmpeg: xem + nghe ----------
function ffprobeDuration(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
    return parseFloat(out.trim()) || 0;
  } catch { return 0; }
}
function extractFrames(file, dur) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'));
  const n = MAX_FRAMES;
  const frames = [];
  // lấy n mốc rải đều, tránh 0s (hay là màn đen) và tránh cuối video
  for (let i = 0; i < n; i++) {
    const t = dur > 1 ? (dur * (i + 0.5) / n) : 0;
    const out = path.join(dir, `f${i}.jpg`);
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t.toFixed(2)), '-i', file,
        '-frames:v', '1', '-vf', 'scale=512:-1', '-q:v', '4', out], { stdio: 'ignore' });
      if (fs.existsSync(out) && fs.statSync(out).size > 0) frames.push(out);
    } catch {}
  }
  return frames;
}
function extractAudio(file) {
  const out = path.join(os.tmpdir(), `audio-${Date.now()}.mp3`);
  try {
    // mono 16k 32kbps, cắt tối đa 12 phút -> nhẹ, dưới trần 25MB của Whisper
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000',
      '-b:a', '32k', '-t', '720', out], { stdio: 'ignore' });
    if (fs.existsSync(out) && fs.statSync(out).size > 200) return out;
  } catch {}
  return null;
}
async function transcribe(audioPath) {
  if (!audioPath || !E.OPENAI_API_KEY) return '';
  try {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)], { type: 'audio/mpeg' }), 'audio.mp3');
    fd.append('model', 'whisper-1');
    const r = await jfetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + E.OPENAI_API_KEY }, body: fd,
    });
    const d = await r.json();
    return (d.text || '').trim();
  } catch (e) { log('  ~ whisper lỗi (bỏ qua):', e.message.slice(0, 120)); return ''; }
}
// ---------- Claude: viết SEO ----------
async function writeSEO({ frames, transcript, channel, dur }) {
  const brand = BRAND[channel] || 'Kênh về cưới & làm đẹp, đối tượng cô dâu Việt Nam.';
  const isShort = dur > 0 && dur <= 65;
  const sys = `Bạn là chuyên gia SEO YouTube tiếng Việt cho ngành cưới & làm đẹp.
${brand}
Nhiệm vụ: dựa vào KHUNG HÌNH (bạn "xem" được) và LỜI THOẠI trong video, viết bộ nội dung tối ưu tìm kiếm YouTube.
QUAN TRỌNG — NỘI DUNG PHẢI BÁM SÁT ĐÚNG VIDEO NÀY:
- Chỉ mô tả những gì THỰC SỰ xuất hiện trong khung hình và lời thoại (đúng cảnh, sản phẩm, kiểu váy/kiểu makeup, hành động, bối cảnh nhìn thấy được).
- TUYỆT ĐỐI không bịa chi tiết không có trong video (không tự nghĩ ra tên sản phẩm, con số, khuyến mãi, địa điểm... nếu video không thể hiện).
- Nếu khung hình mờ/không rõ chủ đề, hãy viết an toàn theo đúng cái quan sát được, đừng suy diễn quá đà.
YÊU CẦU:
- Tiêu đề: <=100 ký tự, đặt từ khóa chính lên đầu, hấp dẫn, tự nhiên, KHÔNG clickbait lố, có thể chèn 1 emoji hợp cảnh.
- Mô tả: 3-6 dòng. Câu đầu chứa từ khóa chính (2 dòng đầu là phần YouTube hiển thị). Nêu giá trị video, thêm CTA (đăng ký kênh / nhắn tin tư vấn), kết bằng 3-6 hashtag liên quan${isShort ? ' và BẮT BUỘC có #Shorts' : ''}.
- Tags: 10-15 từ khóa tiếng Việt (có thể vài từ tiếng Anh phổ biến), phân tách bằng dấu phẩy, không dấu #, bám đúng nội dung.
Chỉ trả về JSON thuần, không giải thích, không markdown.`;
  const userText = `Kênh: ${channel || '(chưa rõ)'}
Thời lượng: ${dur ? dur.toFixed(0) + 's' : '(không rõ)'} ${isShort ? '(dạng Shorts)' : ''}
Lời thoại (transcript${transcript ? '' : ' — TRỐNG, video có thể chỉ có nhạc → hãy dựa vào khung hình'}):
"""${(transcript || '(không có lời nói)').slice(0, 4000)}"""

Trả về đúng JSON: {"tieu_de": "...", "mo_ta": "...", "tags": "tag1, tag2, ..."}`;

  const content = [];
  for (const fp of frames) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(fp).toString('base64') } });
  }
  content.push({ type: 'text', text: userText });

  const r = await jfetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': E.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: sys, messages: [{ role: 'user', content }] }),
  });
  const d = await r.json();
  if (d.error) throw new Error('Claude: ' + JSON.stringify(d.error).slice(0, 200));
  const raw = (d.content || []).map(b => b.text || '').join('').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude không trả JSON: ' + raw.slice(0, 150));
  const j = JSON.parse(m[0]);
  const tieuDe = String(j.tieu_de || '').trim().slice(0, 100);
  const moTa = String(j.mo_ta || '').trim();
  const tags = String(j.tags || '').trim();
  if (!tieuDe || !moTa) throw new Error('Claude trả thiếu tiêu đề/mô tả');
  return { tieuDe, moTa, tags };
}
// ---------- main ----------
(async () => {
  if (!TABLE) { console.error('!! Thiếu YT_TABLE_ID'); process.exit(1); }
  if (!E.ANTHROPIC_API_KEY) { console.error('!! Thiếu ANTHROPIC_API_KEY'); process.exit(1); }
  const tk = await larkToken();
  const rows = await listRows(tk);
  const todo = rows.filter(r => {
    const f = r.fields;
    const st = txt(f['Trạng thái']).trim();
    return !!firstVideo(f) && !txt(f['Mô tả']).trim() && st !== 'Đã đăng' && st !== 'Đang đăng';
  }).slice(0, MAX_PER_RUN);

  if (!todo.length) { log('Không có video nào cần viết nội dung (có Video + "Mô tả" trống). Xong.'); return; }
  log(`Có ${todo.length} video cần viết SEO${DRY ? ' (DRY-RUN)' : ''}.`);

  let done = 0, failed = 0;
  for (const r of todo) {
    const f = r.fields;
    const channel = txt(f['Kênh']).trim();
    const vid = firstVideo(f);
    log(`  ▶ record ${r.record_id} | kênh: ${channel || '(chưa chọn)'} | video: ${vid.name || vid.file_token}`);
    let videoPath, frames = [], audioPath;
    try {
      videoPath = await downloadVideo(tk, vid.file_token, vid.name);
      const dur = ffprobeDuration(videoPath);
      frames = extractFrames(videoPath, dur);
      audioPath = extractAudio(videoPath);
      const transcript = await transcribe(audioPath);
      log(`    xem ${frames.length} khung hình · nghe ${transcript ? transcript.length + ' ký tự' : 'không có lời'} · ${dur.toFixed(0)}s`);
      const seo = await writeSEO({ frames, transcript, channel, dur });
      log(`    ✍  Tiêu đề: ${seo.tieuDe}`);
      if (DRY) { log(`    (DRY) Mô tả: ${seo.moTa.slice(0, 120)}...`); log(`    (DRY) Tags: ${seo.tags}`); done++; continue; }
      const ok = await updateRow(tk, r.record_id, { 'Tiêu đề': seo.tieuDe, 'Mô tả': seo.moTa, 'Tags': seo.tags });
      if (ok) { log('    ✔ ĐÃ VIẾT vào bảng'); done++; } else failed++;
    } catch (e) {
      log(`    ✗ LỖI: ${e.message}`);
      failed++;
    } finally {
      try { if (videoPath) fs.unlinkSync(videoPath); } catch {}
      try { if (audioPath) fs.unlinkSync(audioPath); } catch {}
      for (const fr of frames) { try { fs.unlinkSync(fr); } catch {} }
    }
  }
  log(`Xong. Viết: ${done}, Lỗi: ${failed}.`);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
