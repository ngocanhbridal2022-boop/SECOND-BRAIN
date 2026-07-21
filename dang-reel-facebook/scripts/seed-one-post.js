#!/usr/bin/env node
'use strict';
/*
 * seed-one-post.js — TEST: thả bộ comment "lộn xộn về HEBE" (kèm ảnh) vào 1 BÀI GẦN NHẤT
 * của fanpage cưới, để xem thực tế TRƯỚC khi bật đại trà.
 *
 * Chạy:
 *   node seed-one-post.js                 # THỬ: chọn page đầu, lấy bài gần nhất, IN 6 comment (KHÔNG đăng)
 *   node seed-one-post.js --go            # THẬT: thả comment vào bài gần nhất
 *   node seed-one-post.js --page "Hebe"   # lọc page theo tên (chứa chuỗi này)
 *   node seed-one-post.js --post <postId> --page "Hebe" --go   # chỉ định đúng bài
 *
 * Cần biến môi trường: LARK_APP_ID, LARK_APP_SECRET (token FB lấy từ bảng Pages 14.1).
 */
const CH = require('./comment-hebe');
const CFG = {
  APP_ID:      process.env.LARK_APP_ID    || 'cli_aaaa968ce1785e17',
  APP_SECRET:  process.env.LARK_APP_SECRET|| '',
  APP_TOKEN:   process.env.LARK_APP_TOKEN || 'J62zbhBhtaxrpMsaSzljllffpdh',
  PAGES_TABLE: process.env.PAGES_TABLE_ID || 'tblfhrKAsRgqb2Db',
  LARK_DOMAIN: process.env.LARK_DOMAIN    || 'https://open.larksuite.com',
  GRAPH_VER:   process.env.GRAPH_VERSION  || 'v21.0',
};
const GRAPH = `https://graph.facebook.com/${CFG.GRAPH_VER}`;
const ARG = process.argv.slice(2);
const GO  = ARG.includes('--go');
const val = k => { const i=ARG.indexOf(k); return i>=0 ? ARG[i+1] : null; };
const PAGE_FILTER = val('--page');
const POST_ID     = val('--post');
const plain = v => v==null?'':typeof v==='string'?v:Array.isArray(v)?v.map(x=>x.text||x.name||'').join(''):(v.text||v.name||v.link||String(v));
const log = (...a)=>console.log(...a);
if(!CFG.APP_SECRET){ console.error('!! Thiếu LARK_APP_SECRET'); process.exit(1); }

async function larkToken(){
  const r=await fetch(CFG.LARK_DOMAIN+'/open-apis/auth/v3/tenant_access_token/internal',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:CFG.APP_ID,app_secret:CFG.APP_SECRET})});
  const j=await r.json(); if(j.code!==0)throw new Error('Lark token: '+JSON.stringify(j)); return j.tenant_access_token;
}
async function listAll(tk,tableId){
  let items=[],pt='';
  do{ const r=await fetch(`${CFG.LARK_DOMAIN}/open-apis/bitable/v1/apps/${CFG.APP_TOKEN}/tables/${tableId}/records?page_size=200`+(pt?'&page_token='+pt:''),{headers:{Authorization:'Bearer '+tk}});
    const j=await r.json(); if(j.code!==0)throw new Error('list: '+JSON.stringify(j));
    items=items.concat(j.data.items||[]); pt=j.data.has_more?j.data.page_token:''; }while(pt);
  return items;
}
async function fbFetch(u,o){ const r=await fetch(u,o); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j={_raw:t}}
  if(!r.ok||j.error)throw new Error('FB '+r.status+': '+JSON.stringify(j.error||j._raw||j)); return j; }

async function postComment(objectId, token, message, attachmentUrl){
  const body={access_token:token}; if(message)body.message=message; if(attachmentUrl)body.attachment_url=attachmentUrl;
  return fbFetch(`${GRAPH}/${objectId}/comments`,{method:'POST',body:new URLSearchParams(body)});
}

(async()=>{
  const tk=await larkToken();
  const pageRecs=await listAll(tk, CFG.PAGES_TABLE);
  let pages=pageRecs.map(r=>({fbId:plain(r.fields.ID).trim(), token:plain(r.fields.access_token).trim(), name:plain(r.fields.Fanpage).trim()}))
                    .filter(p=>p.fbId && p.token);
  log(`Có ${pages.length} page có ID+token:`);
  pages.forEach(p=>log(`  • ${p.name} (${p.fbId})`));
  if(PAGE_FILTER){ pages=pages.filter(p=>p.name.toLowerCase().includes(PAGE_FILTER.toLowerCase())); }
  if(pages.length===0){ console.error('!! Không có page khớp --page="'+PAGE_FILTER+'"'); process.exit(1); }
  const pg=pages[0];
  log(`\n➡️  Dùng page: ${pg.name} (${pg.fbId})`);

  // Lấy bài gần nhất (hoặc bài chỉ định)
  let postId=POST_ID, postInfo='(chỉ định)';
  if(!postId){
    const j=await fbFetch(`${GRAPH}/${pg.fbId}/published_posts?fields=id,message,created_time,permalink_url&limit=1&access_token=${encodeURIComponent(pg.token)}`);
    const p=(j.data||[])[0];
    if(!p){ console.error('!! Page chưa có bài published nào'); process.exit(1); }
    postId=p.id; postInfo=`${(p.message||'(không chữ)').slice(0,60).replace(/\n/g,' ')} | ${p.created_time} | ${p.permalink_url||''}`;
  }
  log(`📌 Bài đích: ${postId}\n   ${postInfo}\n`);

  const plan=CH.buildPlan(postId);
  log(`=== Sẽ thả ${plan.length} comment: ===`);
  plan.forEach((c,i)=>log(`  ${i+1}. ${c.imageUrl?'📷':'✍️ '} ${c.message.replace(/\n/g,' ⏎ ')}${c.imageUrl?'\n       ['+c.imageUrl+']':''}`));

  if(!GO){ log('\n(THỬ — chưa đăng gì. Thêm --go để thả thật.)'); return; }

  log('\n>>> Đang thả comment THẬT...');
  let ok=0;
  for(let i=0;i<plan.length;i++){
    const c=plan[i];
    try{ const r=await postComment(postId, pg.token, c.message, c.imageUrl); ok++; log(`   ✔ cmt ${i+1}/${plan.length} (${r.id||''})`); }
    catch(e){ log(`   ✖ cmt ${i+1} lỗi: ${String(e.message||e).slice(0,150)}`); }
    if(i<plan.length-1) await new Promise(r=>setTimeout(r, 3000+Math.floor(Math.random()*3000)));
  }
  log(`\nXong: ${ok}/${plan.length} comment. Mở bài trên Facebook xem thử nha.`);
})().catch(e=>{console.error('FATAL', e.message||e); process.exit(1);});
