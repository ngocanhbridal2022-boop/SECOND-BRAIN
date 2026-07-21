#!/usr/bin/env node
/*
 * post-feed-api.js — Đăng bài (ẢNH lên feed / VIDEO thành Reel) từ bảng "Đăng bài tự động" lên Facebook Page.
 * MỖI DÒNG chọn Page riêng qua cột link "Page" (trỏ tới bảng "14.1 Lấy danh sách pages") → dùng đúng token của page đó.
 * Loại="Hình ảnh" → đăng feed ảnh (/photos + /feed). Loại="Video" → đăng REEL THẬT (/video_reels, upload phân mảnh).
 *
 * Chạy:  node post-feed-api.js            (đăng thật các dòng đủ điều kiện)
 *        node post-feed-api.js --dry-run  (chỉ liệt kê, không đăng, không ghi Base)
 *
 * Điều kiện đăng 1 dòng: Trạng thái ≠ "Thành công" + có Page link + có file Ảnh/video
 *   + (Lịch đăng bài trống hoặc đã tới giờ). Đăng xong set Trạng thái + Log + Link bài đăng.
 *
 * Bí mật qua BIẾN MÔI TRƯỜNG: LARK_APP_SECRET (bắt buộc). Token FB lấy TỪ bảng Pages (không cần env).
 * Tùy chọn: LARK_APP_ID, LARK_APP_TOKEN, LARK_TABLE_ID, PAGES_TABLE_ID, LARK_DOMAIN, GRAPH_VERSION, RESPECT_SCHEDULE.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const CFG = {
  APP_ID:       process.env.LARK_APP_ID    || 'cli_aaaa968ce1785e17',
  APP_SECRET:   process.env.LARK_APP_SECRET|| '',
  APP_TOKEN:    process.env.LARK_APP_TOKEN || 'J62zbhBhtaxrpMsaSzljllffpdh',
  TABLE_ID:     process.env.LARK_TABLE_ID  || 'tbla3Qc2n9uwCN0z',   // Đăng bài tự động
  PAGES_TABLE:  process.env.PAGES_TABLE_ID || 'tblfhrKAsRgqb2Db',   // 14.1 Lấy danh sách pages (ID + access_token)
  LARK_DOMAIN:  process.env.LARK_DOMAIN    || 'https://open.larksuite.com',
  GRAPH_VERSION:process.env.GRAPH_VERSION  || 'v21.0',
  RESPECT_SCHEDULE: process.env.RESPECT_SCHEDULE !== 'false',
};
const GRAPH = `https://graph.facebook.com/${CFG.GRAPH_VERSION}`;
const DRY = process.argv.includes('--dry-run');
if (!DRY && !CFG.APP_SECRET) { console.error('!! Thiếu LARK_APP_SECRET — đặt qua biến môi trường.'); process.exit(1); }

const F = { link:'Link Page', type:'Loại', caption:'Nội dung', comment:'Comment tự động', media:'Ảnh/video',
            schedule:'Lịch đăng bài', status:'Trạng thái', log:'Log', linkPost:'Link bài đăng', ref:'Ref (máy)' };
const COMMENT_DELAY_MS = parseInt(process.env.COMMENT_DELAY_MS || '120000', 10);  // tự bình luận sau 2 phút
const CH = require('./comment-hebe');                                             // bộ comment "lộn xộn về HEBE" + ảnh
const SEED_CMT = process.env.HEBE_SEED_COMMENTS !== '0';                          // bật mặc định; đặt =0 để tắt
// CHỈ seeding comment CƯỚI trên PAGE CƯỚI (né page cá nhân/makeup). Khớp tên page.
const WEDDING_RE = new RegExp(process.env.HEBE_WEDDING_PAGE_RE || 'cưới|bridal|cô dâu', 'i');
const isWeddingPage = name => WEDDING_RE.test(name || '');
const DONE = 'Thành công', FAIL = 'Thất bại';
const now = () => new Date().toISOString().replace('T',' ').slice(0,19);
const log = (...a) => console.log(now(), ...a);
const plain = v => v==null?'':typeof v==='string'?v:Array.isArray(v)?v.map(x=>x.text||x.name||'').join(''):(v.text||v.name||v.link||String(v));
const isVid = a => /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(a.name||'') || /^video/i.test(a.type||'');
const isImg = a => /\.(jpe?g|png|gif|webp|bmp)$/i.test(a.name||'') || /^image/i.test(a.type||'');
// Lấy record_ids từ cell link — API list trả MẢNG [{record_ids:[...]}], API 1-record trả OBJECT {record_ids:[...]}.
const linkRecIds = cell => { if(!cell) return [];
  const arr = Array.isArray(cell) ? cell : [cell]; let ids=[];
  for(const el of arr){ if(!el) continue;
    if(Array.isArray(el.record_ids)) ids=ids.concat(el.record_ids);
    else if(el.record_id) ids.push(el.record_id);
    else if(typeof el==='string') ids.push(el); }
  return ids.filter(Boolean); };

async function larkToken() {
  const r = await fetch(CFG.LARK_DOMAIN+'/open-apis/auth/v3/tenant_access_token/internal',
    { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({app_id:CFG.APP_ID,app_secret:CFG.APP_SECRET}) });
  const j = await r.json(); if (j.code!==0) throw new Error('Lark token: '+JSON.stringify(j)); return j.tenant_access_token;
}
async function listAll(tk, tableId) {
  let items=[], pt='';
  do { const r=await fetch(`${CFG.LARK_DOMAIN}/open-apis/bitable/v1/apps/${CFG.APP_TOKEN}/tables/${tableId}/records?page_size=200`+(pt?'&page_token='+pt:''),{headers:{Authorization:'Bearer '+tk}});
    const j=await r.json(); if(j.code!==0)throw new Error('list '+tableId+': '+JSON.stringify(j));
    items=items.concat(j.data.items||[]); pt=j.data.has_more?j.data.page_token:''; } while(pt);
  return items;
}
async function listFields(tk, tableId) {
  const r=await fetch(`${CFG.LARK_DOMAIN}/open-apis/bitable/v1/apps/${CFG.APP_TOKEN}/tables/${tableId}/fields?page_size=200`,{headers:{Authorization:'Bearer '+tk}});
  const j=await r.json(); if(j.code!==0)throw new Error('fields: '+JSON.stringify(j));
  return (j.data.items||[]).map(f=>({name:f.field_name,type:f.type}));
}
async function updateRow(tk, recId, fields) {
  const r=await fetch(`${CFG.LARK_DOMAIN}/open-apis/bitable/v1/apps/${CFG.APP_TOKEN}/tables/${CFG.TABLE_ID}/records/${recId}`,
    {method:'PUT',headers:{'Content-Type':'application/json; charset=utf-8',Authorization:'Bearer '+tk},body:JSON.stringify({fields})});
  const j=await r.json(); if(j.code!==0)throw new Error('update: '+JSON.stringify(j));
}
async function downloadMedia(tk, fileToken, out) {
  const tries=[ `${CFG.LARK_DOMAIN}/open-apis/drive/v1/medias/${fileToken}/download?extra=${encodeURIComponent(JSON.stringify({bitablePerm:{tableId:CFG.TABLE_ID}}))}`,
                `${CFG.LARK_DOMAIN}/open-apis/drive/v1/medias/${fileToken}/download` ];
  for (const u of tries) { const r=await fetch(u,{headers:{Authorization:'Bearer '+tk}});
    if (r.ok && (r.headers.get('content-type')||'').indexOf('json')<0) { const b=Buffer.from(await r.arrayBuffer()); fs.writeFileSync(out,b); return b.length; } }
  throw new Error('không tải được media từ Lark');
}
async function fbFetch(u,o){ const r=await fetch(u,o); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j={_raw:t}}
  if(!r.ok||j.error)throw new Error('FB '+r.status+': '+JSON.stringify(j.error||j._raw||j)); return j; }

// Đăng feed nhiều ảnh: upload từng ảnh (published=false) → media_fbid → tạo post /feed đính kèm.
async function postPhotos(pageId, token, files, caption) {
  const fbids=[];
  for (const f of files) {
    const fd=new FormData(); fd.set('access_token',token); fd.set('published','false');
    fd.set('source', new Blob([fs.readFileSync(f.path)]), f.name||'photo.jpg');
    const j=await fbFetch(`${GRAPH}/${pageId}/photos`,{method:'POST',body:fd});
    if(!j.id) throw new Error('upload ảnh không có id'); fbids.push(j.id);
  }
  const body=new URLSearchParams(); body.set('access_token',token); if(caption)body.set('message',caption);
  fbids.forEach((id,i)=>body.set(`attached_media[${i}]`, JSON.stringify({media_fbid:id})));
  const post=await fbFetch(`${GRAPH}/${pageId}/feed`,{method:'POST',body});
  return { objectId:post.id, permalink:`https://www.facebook.com/${post.id}` };
}
// Đăng Reel thật (không phải video feed thường) — upload phân mảnh 3 pha: start → upload binary → finish.
async function postVideo(pageId, token, file, caption) {
  const start=await fbFetch(`${GRAPH}/${pageId}/video_reels?upload_phase=start&access_token=${encodeURIComponent(token)}`,{method:'POST'});
  const videoId=start.video_id, uploadUrl=start.upload_url;
  if(!videoId||!uploadUrl) throw new Error('start thiếu video_id/upload_url');
  const buf=fs.readFileSync(file.path);
  await fbFetch(uploadUrl,{method:'POST',headers:{Authorization:`OAuth ${token}`,offset:'0',file_size:String(buf.length)},body:buf});
  await fbFetch(`${GRAPH}/${pageId}/video_reels`,{method:'POST',body:new URLSearchParams({upload_phase:'finish',video_id:videoId,video_state:'PUBLISHED',description:caption||'',access_token:token})});
  let permalink='';
  for(let i=0;i<30;i++){ await new Promise(r=>setTimeout(r,6000));
    try{ const st=await fbFetch(`${GRAPH}/${videoId}?fields=status,permalink_url&access_token=${encodeURIComponent(token)}`,{method:'GET'});
      const phase=st.status&&(st.status.video_status||(st.status.processing_phase&&st.status.processing_phase.status));
      if(st.permalink_url)permalink=st.permalink_url;
      if(phase==='ready'||phase==='PUBLISHED'||(st.status&&st.status.video_status==='ready'))break;
      if(phase==='error')throw new Error('FB xử lý lỗi: '+JSON.stringify(st.status)); }catch(e){}
  }
  if(permalink&&permalink.startsWith('/'))permalink='https://www.facebook.com'+permalink;
  return { objectId:videoId, permalink:permalink||`https://www.facebook.com/${videoId}` };
}
async function postComment(pageId, token, objectId, message, attachmentUrl){
  const body={access_token:token};
  if(message) body.message=message;
  if(attachmentUrl) body.attachment_url=attachmentUrl;   // FB tự tải ảnh công khai gắn kèm (1 ảnh/cmt)
  return fbFetch(`${GRAPH}/${objectId}/comments`,{method:'POST',body:new URLSearchParams(body)});
}
function scheduleMs(cell){ if(cell==null)return null; if(typeof cell==='number')return cell; // Lark datetime = epoch ms
  const t=plain(cell).trim(); if(!t)return null;
  const m=t.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); if(m)return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5]).getTime();
  const d=new Date(t); return isNaN(d)?null:d.getTime(); }

(async()=>{
  const tk=await larkToken();
  // Tự dò cột link tới bảng Pages (type 18 single-link / 21 duplex-link) — không phụ thuộc tên cột.
  try {
    const flds=await listFields(tk, CFG.TABLE_ID);
    const lf=flds.find(f=>f.type===18||f.type===21) || flds.find(f=>/page/i.test(f.name));
    if(lf) F.link=lf.name;
    log(`Cột link Page = "${F.link}".`);
  } catch(e){ log('! không đọc được fields, dùng mặc định "'+F.link+'": '+String(e.message||e)); }
  // map record_id (bảng Pages) -> {fbId, token, name}
  const pageRecs=await listAll(tk, CFG.PAGES_TABLE);
  const pageMap=new Map();
  for(const r of pageRecs){ pageMap.set(r.record_id, { fbId:plain(r.fields.ID).trim(), token:plain(r.fields.access_token).trim(), name:plain(r.fields.Fanpage).trim() }); }

  const rows=await listAll(tk, CFG.TABLE_ID);
  const nowMs=Date.now();
  let ok=0,err=0,wait=0,skip=0;
  const pending=[];   // hàng đợi bình luận: đăng xong CẢ LOẠT rồi chờ 2 phút mới cmt (FB đỡ bóp reach bài có link)
  for(const row of rows){
    const recId=row.record_id;
    if(plain(row.fields[F.status])===DONE) { skip++; continue; }              // đã đăng
    const pageRecIds=linkRecIds(row.fields[F.link]);                          // ĐA PAGE: lấy TẤT CẢ page được chọn
    const atts=Array.isArray(row.fields[F.media])?row.fields[F.media]:[];
    if(pageRecIds.length===0 || atts.length===0) { skip++; continue; }        // dòng chưa sẵn sàng → bỏ qua im lặng

    // CHỐT AN TOÀN: dòng còn "nháp" thì KHÔNG đăng.
    //  - Chưa có Nội dung  → tránh đăng bài trống chữ.
    //  - Chưa hẹn Lịch đăng → tránh đăng sớm khi cô mới thả ảnh vào kho, chưa lên lịch.
    // (Muốn đăng ngay: chỉ cần đặt Lịch đăng = thời điểm hiện tại/quá khứ.)
    if(!plain(row.fields[F.caption]).trim()) { log(`  [NHÁP] ${recId}: chưa có Nội dung → chưa đăng`); skip++; continue; }
    const schedMs = scheduleMs(row.fields[F.schedule]);
    if(!schedMs) { log(`  [NHÁP] ${recId}: chưa hẹn Lịch đăng → chưa đăng`); skip++; continue; }

    if(CFG.RESPECT_SCHEDULE && schedMs>nowMs){ log(`  [CHỜ GIỜ] ${recId}: hẹn ${new Date(schedMs).toISOString().slice(0,16)}`); wait++; continue; }

    // Chỉ giữ page có đủ ID + token trong bảng 14.1
    const pages=pageRecIds.map(id=>({recId:id,...(pageMap.get(id)||{})})).filter(p=>p.fbId&&p.token);
    if(pages.length===0){ log(`  [LỖI] ${recId}: các Page link đều thiếu ID/token trong 14.1`); if(!DRY)await updateRow(tk,recId,{[F.status]:FAIL,[F.log]:`${now()} - Page thiếu ID/token`}); err++; continue; }

    const caption=plain(row.fields[F.caption]);
    const loai=plain(row.fields[F.type]);
    let kind = /video/i.test(loai) ? 'video' : /ảnh|hình|image|photo/i.test(loai) ? 'image' : (atts.some(isVid)?'video':'image');
    const files = kind==='video' ? [ atts.find(isVid)||atts[0] ] : atts.filter(a=>isImg(a)||!isVid(a));
    log(`  >> ${recId} | ${pages.length} page [${pages.map(p=>p.name).join(', ')}] | ${kind} | ${files.length} file | "${caption.slice(0,40).replace(/\n/g,' ')}"`);
    if(DRY){ const c=plain(row.fields[F.comment]).trim(); if(c)log(`     [DRY] comment tay: ${c.slice(0,60)}`);
      if(SEED_CMT && pages.some(p=>isWeddingPage(p.name))){ const plan=CH.buildPlan('dry_'+recId);
        plan.forEach((x,i)=>log(`     [DRY] cmt HEBE ${i+1}${x.imageUrl?'📷':'  '}: ${x.message.slice(0,55).replace(/\n/g,' ')}${x.imageUrl?'  | '+x.imageUrl.replace(CH.IMG,'…'):''}`)); }
      else if(SEED_CMT) log(`     [DRY] (không seed cmt HEBE — page ≠ cưới)`);
      continue; }

    const tmp=[];
    try{
      // Tải media 1 lần rồi đăng cho từng page
      for(let i=0;i<files.length;i++){ const f=files[i]; const p=path.join(os.tmpdir(),`feed_${recId}_${i}_${(f.name||'m').replace(/[^\w.]/g,'')}`);
        await downloadMedia(tk,f.file_token,p); f.path=p; tmp.push(p); }
      const commentText=plain(row.fields[F.comment]).trim();
      const results=[], refs=[]; let anyOk=false;
      for(const pg of pages){
        try{
          const res = kind==='video' ? await postVideo(pg.fbId,pg.token,files[0],caption)
                                      : await postPhotos(pg.fbId,pg.token,files,caption);
          // Có nội dung ở "Comment tự động" → xếp hàng, cmt SAU 2 phút (không cmt ngay)
          if(commentText) pending.push({fbId:pg.fbId,token:pg.token,oid:res.objectId,msg:commentText,name:pg.name});
          // + Bộ comment "lộn xộn về HEBE" KÈM ẢNH (cô Ánh chốt 2026-07-20). CHỈ trên PAGE CƯỚI. Thả sau 2 phút.
          let seedN=0;
          if(SEED_CMT && isWeddingPage(pg.name)) for(const c of CH.buildPlan(res.objectId)){
            pending.push({fbId:pg.fbId,token:pg.token,oid:res.objectId,msg:c.message,img:c.imageUrl,name:pg.name}); seedN++;
          }
          results.push(`${pg.name}: OK ${res.objectId}${commentText?' [+cmt hẹn]':''}${seedN?` [+${seedN} cmt HEBE]`:(SEED_CMT&&!isWeddingPage(pg.name)?' [không seed: page ≠ cưới]':'')}`);
          refs.push({t:'fb',oid:res.objectId,page:pg.recId,link:res.permalink});
          anyOk=true; log(`     ✔ ${pg.name}: ${res.permalink}`);
        }catch(e){ const m=String(e.message||e).slice(0,150); results.push(`${pg.name}: LỖI ${m}`); log(`     ✖ ${pg.name}: ${m}`); }
      }
      // Gộp Ref (máy): giữ ref YouTube (nếu step YT đã ghi), thay ref FB của lần này
      let allRefs=[]; try{ allRefs=JSON.parse(plain(row.fields[F.ref])||'[]'); if(!Array.isArray(allRefs))allRefs=[]; }catch{}
      allRefs=allRefs.filter(x=>x&&x.t!=='fb').concat(refs);
      const firstLink=(refs.find(r=>r.link)||{}).link||'';
      const fields={ [F.log]:`${now()} - ${results.join(' | ')}`.slice(0,900), [F.ref]:JSON.stringify(allRefs) };
      if(firstLink) fields[F.linkPost]={link:firstLink,text:'Xem bài'};
      // ≥1 page OK → "Thành công" (KHÔNG retry để tránh đăng trùng các page đã lên); tất cả fail → "Thất bại" (chạy lại lượt sau)
      fields[F.status]= anyOk ? DONE : FAIL;
      await updateRow(tk,recId,fields);
      if(anyOk) ok++; else err++;
    }catch(e){ const msg=String(e.message||e).slice(0,300); log(`     ✖ LỖI: ${msg}`);
      try{await updateRow(tk,recId,{[F.status]:FAIL,[F.log]:`${now()} - LỖI - ${msg}`});}catch{} err++;
    }finally{ tmp.forEach(p=>{try{fs.unlinkSync(p)}catch{}}); }
  }
  // ===== TỰ BÌNH LUẬN SAU 2 PHÚT =====
  // Đăng xong hết mới chờ 1 lần rồi thả bình luận (link ebook/phễu...) xuống từng bài.
  if(pending.length){
    if(DRY){ log(`[DRY] sẽ tự bình luận ${pending.length} bài sau ${Math.round(COMMENT_DELAY_MS/1000)}s.`); }
    else{
      log(`Chờ ${Math.round(COMMENT_DELAY_MS/1000)}s rồi tự bình luận ${pending.length} bài...`);
      await new Promise(r=>setTimeout(r,COMMENT_DELAY_MS));
      let c=0;
      for(let i=0;i<pending.length;i++){
        const p=pending[i];
        try{ await postComment(p.fbId,p.token,p.oid,p.msg,p.img); c++; log(`     💬${p.img?'📷':''} đã bình luận: ${p.name} (${p.oid})`); }
        catch(e){ log(`     ! bình luận lỗi ${p.name}: ${String(e.message||e).slice(0,140)}`); }
        if(i<pending.length-1) await new Promise(r=>setTimeout(r, 3000 + Math.floor(Math.random()*3000))); // rải 3–6s chống spam
      }
      log(`Bình luận xong: ${c}/${pending.length}.`);
    }
  }
  log(`Xong. Đăng: ${ok}, Lỗi: ${err}, Chờ giờ: ${wait}, Bỏ qua: ${skip}.`);
})().catch(e=>{console.error('FATAL',e.message||e);process.exit(1);});
