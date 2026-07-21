'use strict';
/*
 * comment-hebe.js — Sinh 3–4 bình luận "lộn xộn về HEBE" (KÈM ẢNH) cho MỖI bài fanpage cưới.
 *
 * Cô Ánh chốt 2026-07-20: dưới mỗi bài mới đăng cần ÍT NHẤT 3 bình luận nói về HEBE, giọng
 * khác nhau cho tự nhiên, CÓ HÌNH càng tốt. Comment bằng CHÍNH Page HEBE (an toàn, đúng luật FB)
 * → cùng tên Page nhưng NỘI DUNG + ẢNH khác nhau để phần bình luận sống động.
 *
 * 4 nhóm: (A) khoe FEEDBACK khách  (B) khoe MẪU VÁY/ALBUM  (C) TEASER ưu đãi kéo inbox
 *         (D) TÀI NGUYÊN ebook + xem tuổi (chỉ chữ).
 * Ảnh = URL công khai đang sống trên cuoi.hebestudio.vn → gắn qua attachment_url của FB (1 ảnh/cmt).
 * Mỗi bài bốc biến thể CỐ ĐỊNH theo post_id (băm md5) → cùng bài ra cùng bộ, bài khác ra bộ khác.
 *
 * buildPlan(seed) → [{message, imageUrl|null}, ...]  (mặc định 4 mục; HEBE_CMT_COUNT>=3 để đổi).
 */
const crypto = require('crypto');

const IMG = 'https://cuoi.hebestudio.vn/assets/img';
const FEEDBACK_IMGS = Array.from({length:6}, (_,i)=>`${IMG}/feedback/fb${i+1}.jpg`);
const VAY_IMGS      = Array.from({length:12},(_,i)=>`${IMG}/vay/vay${String(i+1).padStart(2,'0')}.jpg`);
const ALBUM_IMGS    = ['album1','album2','album3','album3b','couple1'].map(n=>`${IMG}/${n}.jpg`);
const GOI_IMGS      = ['goi1','goi2','goi3'].map(n=>`${IMG}/${n}.jpg`);

const EBOOK='ebook.hebestudio.vn', XEMTUOI='xemtuoicuoi.hebestudio.vn';
const SALE='cuoi.hebestudio.vn', HOTLINE='0964 545 457';

const CMT_FEEDBACK = [
  'Vài dòng cô dâu nhắn lại sau ngày cưới 🥰 Cảm ơn các bạn đã tin HEBE nha 🤍',
  'Feedback tuần này của tụi mình nè, đọc mà thương ghê 💛',
  'Niềm vui của HEBE là được nghe những lời này từ cô dâu 🌿 Cảm ơn cả nhà!',
  'Một chút phản hồi thật từ khách nhà HEBE 🤍 Biết ơn các bạn nhiều lắm!',
  'Tin nhắn của cô dâu gửi về, HEBE giữ lại làm động lực 💞',
];
const CMT_VAY = [
  'Thêm vài mẫu mới về nè cả nhà, bạn nào thích concept này inbox HEBE nha 💍',
  'Khoe nhẹ một góc album tụi mình mới chụp 🤍 Xinh không mọi người?',
  'Mẫu đang được các cô dâu chọn nhiều tháng này 👗✨ Bạn nào ưng nhắn HEBE nhé!',
  'Một vài khoảnh khắc HEBE lưu lại cho các cặp đôi 💞',
  'Concept này nhiều bạn hỏi lắm nè 🌸 Ai thích để lại tim HEBE tư vấn nha!',
];
const CMT_OFFER = [
  'Đang có ưu đãi gói ra mắt nha cả nhà, bạn nào cưới cuối năm inbox HEBE giữ lịch sớm nhé 💛',
  `Nhiều bạn hỏi bảng giá — HEBE gửi riêng qua tin nhắn cho mình nha, inbox HEBE hoặc gọi ${HOTLINE} 💍`,
  'Gói ưu đãi số lượng có hạn, cô dâu quan tâm nhắn HEBE để tụi mình tư vấn nha 🤍',
  `Bạn nào cần báo giá & giữ lịch thì inbox HEBE hoặc gọi ${HOTLINE} nhé, tụi mình phản hồi nhanh 💞`,
];
// ===== (D) SALE PAGE cuoi.hebestudio.vn — RIÊNG 1 comment, kèm ảnh album =====
const CMT_SALE = [
  `Bảng giá & các gói chụp cưới HEBE mình để đầy đủ ở đây nha: ${SALE} 💍`,
  `Cô dâu nào muốn xem trọn gói dịch vụ + giữ lịch thì ghé ${SALE} nhé 🤍`,
  `Tất cả dịch vụ cưới của HEBE (chụp, váy, trang điểm) xem tại ${SALE} nha 🌿`,
  `Xem concept, mẫu váy và bảng giá chi tiết tại ${SALE} nha cả nhà 💞`,
];

// ===== (E) XEM TUỔI CƯỚI xemtuoicuoi.hebestudio.vn — RIÊNG 1 comment (chữ) =====
const CMT_XEMTUOI = [
  `Hai bạn tính cưới năm nay thử xem tuổi có hợp không nha 💞 ${XEMTUOI}`,
  `Xem tuổi hợp kết hôn miễn phí HEBE làm nè: ${XEMTUOI} 🔮`,
  `Trước khi chốt ngày cưới, ngó thử tuổi hai bạn tại ${XEMTUOI} nha 🤍`,
  `Tò mò tuổi hai bạn hợp cưới không? Xem thử nha: ${XEMTUOI} 💫`,
];

// ===== (F) EBOOK ebook.hebestudio.vn — RIÊNG 1 comment (chữ) =====
const CMT_EBOOK = [
  `Cẩm nang "Cưới không lỗ" (lộ trình 6 tháng + checklist) tải free ở đây: ${EBOOK} 📘`,
  `Bạn nào đang lên kế hoạch cưới lấy cẩm nang này đọc cho đỡ loạn nha: ${EBOOK} 📘`,
  `HEBE tặng cẩm nang chuẩn bị cưới khỏi thiếu sót: ${EBOOK} 🎁`,
];

function hnum(seed, salt){
  const h = crypto.createHash('md5').update(String(seed)+'|'+salt).digest('hex');
  return parseInt(h.slice(0,12), 16);
}
function pick(list, seed, salt){ return list[ hnum(seed, salt) % list.length ]; }

function buildPlan(seed, count){
  const useAlbum = hnum(seed,'ab') % 2 === 0;
  // Xen kẽ: nội dung khoe + link nằm rải rác, KHÔNG dồn link xuống cuối. Mỗi link 1 comment RIÊNG.
  const plan = [
    { message: pick(CMT_FEEDBACK, seed,'fbk'), imageUrl: pick(FEEDBACK_IMGS, seed,'fbimg') },       // A feedback + ảnh
    { message: pick(CMT_SALE,     seed,'sal'), imageUrl: pick(ALBUM_IMGS, seed,'salimg') },          // D sale page + ảnh album
    { message: pick(CMT_VAY,      seed,'vay'), imageUrl: pick(useAlbum?ALBUM_IMGS:VAY_IMGS, seed,'vayimg') }, // B váy/album + ảnh
    { message: pick(CMT_XEMTUOI,  seed,'xt'),  imageUrl: null },                                      // E xem tuổi (riêng)
    { message: pick(CMT_OFFER,    seed,'ofr'), imageUrl: pick(GOI_IMGS, seed,'ofrimg') },             // C ưu đãi + ảnh gói
    { message: pick(CMT_EBOOK,    seed,'ebk'), imageUrl: null },                                      // F ebook (riêng)
  ];
  if(count==null){ count = parseInt(process.env.HEBE_CMT_COUNT || '6', 10); if(isNaN(count)) count=6; }
  count = Math.max(3, Math.min(count, plan.length));
  return plan.slice(0, count);
}

module.exports = { buildPlan, IMG };

// Xem thử (không gọi Facebook):  node comment-hebe.js [seed]
if (require.main === module) {
  const seed = process.argv[2] || 'demo_post_123';
  buildPlan(seed).forEach((c,i)=>{
    console.log(`--- Comment ${i+1} ---`);
    console.log(c.message);
    console.log(`[ảnh] ${c.imageUrl || '(không ảnh)'}\n`);
  });
}
