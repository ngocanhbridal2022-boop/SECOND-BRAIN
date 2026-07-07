# Máy viết nội dung chuẩn SEO YouTube (bảng 16.3)

Tự động điền **Tiêu đề + Mô tả + Tags** tối ưu SEO cho video trong bảng 16.3 (base J62z, `tbl7cPQda7c6w8ne`).

## Cách hoạt động
- Chạy cloud GitHub Actions, cron **20 phút/lần** (`viet-seo-youtube.yml`).
- Quét bảng 16.3, chọn dòng **có Video** nhưng **"Mô tả" còn trống** (chưa viết), tối đa 3 dòng/lượt.
- Tải video từ Lark → `ffmpeg` lấy tối đa 6 khung hình + tách tiếng nói → Whisper chép lời.
- **Claude "xem" khung hình + "nghe" lời thoại** → viết Tiêu đề (≤100 ký tự), Mô tả (có CTA + hashtag), Tags (10–15 từ khóa), bám ngữ cảnh kênh (Hebe cưới / Ngọc Ánh makeup).
- Ghi ngược vào bảng. **KHÔNG** đụng Trạng thái / Ngày giờ đăng → cô duyệt lại rồi đặt giờ + "Chờ đăng"; máy đăng (`post-youtube.mjs`) lo phần đăng.

## Secrets cần có trên GitHub
- `YT_LARK_APP_SECRET` (đã có — dùng chung máy đăng)
- `ANTHROPIC_API_KEY` (Claude viết nội dung)
- `OPENAI_API_KEY` (Whisper chép lời; thiếu vẫn chạy, chỉ dựa vào khung hình)

## Chạy thử
Actions → **viet-seo-youtube** → Run workflow → tích "Chỉ viết thử ra log" để xem trước, không ghi bảng.

## Chỉnh
- Đổi model: env `YT_SEO_MODEL` (mặc định `claude-opus-4-8`; đổi `claude-sonnet-4-6` để rẻ hơn).
- Số video mỗi lượt: env `YT_SEO_MAX_PER_RUN` (mặc định 3).
