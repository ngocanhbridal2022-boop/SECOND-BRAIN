---
name: dang-reel-facebook
description: Hệ thống đăng video Reel từ Lark Base lên Facebook Page, chạy THEO YÊU CẦU — chỉ thực thi khi skill được gọi, KHÔNG quét nền/định kỳ. Upload Reels qua Graph API phân mảnh (không qua Anycross nên không dính trần dung lượng). Dùng khi cần đăng các Reel đang ở trạng thái "Chờ đăng", triển khai/đóng gói bộ cho học viên/khách, sửa logic đăng, hoặc xử lý lỗi token Facebook.
---

# Đăng Reel Facebook tự động (Lark Base → FB Page)

Người dùng đính video + viết caption vào Lark Base và đặt `TT Reel = Chờ đăng`. **Khi skill được gọi**, hệ thống chạy `post-reels.js` MỘT lần: quét các dòng "Chờ đăng", đăng lên Facebook Page, rồi ghi link/log ngược về Base. **Không có tiến trình quét nền/định kỳ.**

## Khi nào dùng skill này
- Đóng gói **bản chuyển giao** cho học viên/khách mới (admin).
- Cài đặt trên máy học viên (theo wizard).
- Sửa/mở rộng `post-reels.js`, đổi field, đổi lịch quét.
- Xử lý sự cố: token FB hết hạn, video sai định dạng, không đăng đúng giờ.

## Kiến trúc & luồng
```
Lark Base (TT Reel = "Chờ đăng")
   │  GỌI SKILL → chạy post-reels.js MỘT lần (on-demand, KHÔNG quét nền)
   ▼
post-reels.js:
   1. lark-cli +record-list  → tìm dòng "Chờ đăng" (tôn trọng "Lịch đăng" nếu có)
   2. +record-download-attachment → tải video về %TEMP%\reel-work
   3. Facebook Graph API video_reels 3 pha: start → upload binary → finish/PUBLISHED
   4. poll status → lấy permalink
   5. +record-batch-update → TT Reel="Đã đăng" + Link Reel + Log (hoặc "Lỗi" + lý do)
```
**Điểm mấu chốt:** upload thẳng Graph API (không qua Anycross) → **không dính trần dung lượng video**.

## Schema Base mẫu (field — đúng tên, phân biệt hoa thường & dấu)
| Field | Kiểu | Vai trò |
|---|---|---|
| `TT Reel` | Single Select | Trạng thái: **Chờ đăng** (kích hoạt) / Đã đăng / Lỗi |
| `Ảnh/video` | Attachment | Video MP4 dọc 9:16, 3–90s |
| `Nội dung` | Text | Caption |
| `Hastag` | Text | Hashtag (ghép xuống dưới caption) |
| `Lịch đăng` | DateTime | Hẹn giờ (trống = đăng ngay) |
| `Link Reel` | Text/URL | Máy ghi link bài sau khi đăng |
| `Log đăng Reel` | Text | Máy ghi OK / lỗi / RETRY n/3 |

Tên field được khai trong `post-reels.js` (object `F`). Đổi tên cột trên Base ⇒ phải sửa `F` cho khớp.

## Logic quan trọng (post-reels.js)
- **Trigger:** chỉ xử lý dòng `TT Reel = CFG.TRIGGER` ("Chờ đăng").
- **RESPECT_SCHEDULE:** nếu `Lịch đăng` ở tương lai → bỏ qua (KHÔNG đăng); trống hoặc đã tới giờ → đăng ngay. ⚠️ Ở chế độ on-demand không có quét nền, nên dòng hẹn giờ tương lai **chỉ được đăng khi bạn gọi skill lại vào/sau thời điểm đó**. Muốn đăng tất cả "Chờ đăng" ngay bất kể lịch → đặt `RESPECT_SCHEDULE: false` trong `config.local.json`.
- **Phân loại lỗi:** `isPermanent()` (token/permission/định dạng/độ dài...) → set "Lỗi" ngay; lỗi tạm thời (mạng/5xx) → giữ "Chờ đăng", retry tới `MAX_RETRY` (mặc định 3), đếm qua "RETRY n/3" trong Log → lần gọi skill sau tự thử lại.
- **Lock:** `%TEMP%\reel-work\post-reels.lock` chống chạy chồng khi video lớn còn đang upload (lock <30' coi như đang chạy).
- **WORK dir = %TEMP%\reel-work** (không đặt trong thư mục có dấu cách/tiếng Việt vì lark-cli @file/--output lỗi).
- `--dry-run`: in ra, không đăng, không ghi Base.

## Cách thực thi (on-demand — không quét nền)
Có 2 runner; chọn theo môi trường:

**A. `scripts/post-reels-api.js` (KHUYẾN NGHỊ — KHÔNG cần lark-cli).** Dùng Lark Open API (app token) + FB Graph API, chỉ cần Node 18+. CONFIG đã nhúng sẵn (base `Lytbb51...`, bảng `Đăng Reel` `tblopLrHPe2A4QB0`, FB page `John CVTI`).
```
node scripts/post-reels-api.js            # đăng tất cả dòng "Chờ đăng"
node scripts/post-reels-api.js --dry-run  # chỉ liệt kê
```
→ **Khi gọi skill `dang-reel-facebook`, đây là lệnh được chạy.** Đã kiểm chứng đăng thành công (tự tải video từ Base → upload Reels → ghi "Đã đăng" + Link Reel về Base).

**B. `scripts/bo-cai/post-reels.js` (bản gốc, dùng lark-cli).** Dành cho bản chuyển giao học viên tự cài: cần `npm i -g @larksuite/cli` + `lark-cli auth login` + `config.local.json`. Chạy `node post-reels.js` hoặc bấm `DANG-NGAY.bat`.

## Quy trình ADMIN — chuẩn bị bản chuyển giao (1 lần)
1. **Điền `scripts/bo-cai/_app.json`:** `APP_SECRET` của app Lark dùng chung (vd "ADS → LARK", App ID `cli_a736cbaaa63bd010`). App cần scope base + drive; học viên phải cùng workspace Lark (hoặc app cài cho tổ chức họ). ⚠️ File chứa secret → gửi qua kênh riêng tư, KHÔNG public.
2. **Base mẫu:** có sẵn đủ field; chia sẻ link + bật quyền *Make a copy* cho học viên. (Link mẫu cũ: `https://studiosuccess.sg.larksuite.com/base/Ahs4bAY2ZaUc6jscpykl4Vynglb`.)
3. **Lấy FB token cho TỪNG học viên:** Page Access Token dài hạn, scope `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`. Gửi 2 dòng: **FB PAGE ID** + **FB PAGE TOKEN**. Token ~60 ngày phải cấp lại.
4. **Nén & gửi:** zip thư mục `bo-cai` (đã điền `_app.json`) + kèm: link Base mẫu, FB PAGE ID, FB PAGE TOKEN. Bảo học viên đọc `HUONG-DAN-HOC-VIEN.md`. KHÔNG gửi `README-ADMIN.md`.

## Quy trình HỌC VIÊN — cài đặt (~10 phút)
1. **Nhân bản Base mẫu** → copy link Base (dạng `https://....larksuite.com/base/xxxx?table=tblyyyy`).
2. Bấm đúp **`CAI-DAT.bat`** (SmartScreen → More info → Run anyway). Wizard `setup.ps1` sẽ:
   - Cài Node (winget) + lark-cli (`npm i -g @larksuite/cli`).
   - Nạp app Lark (`init-app.js` đẩy secret qua stdin, tránh `\r\n` làm hỏng).
   - `lark-cli auth login` → học viên đăng nhập Lark, Authorize.
   - Dán **link Base** (tự tách BASE_TOKEN + TABLE_ID) + **FB PAGE ID** + **FB PAGE TOKEN** → ghi `config.local.json`.
3. Thấy **HOAN TAT!** là xong — KHÔNG đăng ký quét nền. Việc đăng chỉ chạy khi gọi skill (`node post-reels.js`).

> Chế độ on-demand: **bỏ qua bước `register-task.ps1`** (không tạo Scheduled Task 2 phút). Nếu khách vẫn muốn tự động định kỳ, chạy `register-task.ps1` là tùy chọn — nhưng mặc định của skill này là on-demand.

## Dùng hằng ngày
Trong Base: đính video vào `Ảnh/video`, viết `Nội dung` (+`Hastag`), đặt `TT Reel = Chờ đăng`. Sau đó **gọi skill** (chạy `post-reels.js`) → máy đăng và đổi `TT Reel = Đã đăng` + điền `Link Reel`. Vì không quét nền, dòng `Lịch đăng` hẹn tương lai chỉ lên khi bạn gọi skill vào/sau giờ đó (hoặc đặt `RESPECT_SCHEDULE: false` để đăng ngay mọi dòng "Chờ đăng").

## Lỗi thường gặp
- **Log "OAuthException / token"** → token FB hết hạn (~60 ngày). Admin cấp token mới → học viên sửa `config.local.json` → `FB_PAGE_TOKEN`.
- **Lỗi định dạng/độ dài** → video phải MP4 dọc 9:16, 3–90s.
- **Để "Chờ đăng" không lên** → chưa gọi skill, hoặc `Lịch đăng` còn ở tương lai (on-demand không tự đăng đúng giờ — phải gọi lại).
- **Đăng lại 1 bài** → đặt lại `TT Reel = Chờ đăng` rồi gọi skill.

## Yêu cầu máy
Windows 10/11, quyền cài phần mềm (Node), đã `lark-cli auth login`. Không cần máy bật liên tục (chỉ chạy khi gọi skill).

## Giới hạn đã biết
- **Chế độ on-demand:** không có quét nền/định kỳ → `Lịch đăng` hẹn giờ KHÔNG tự kích hoạt; phải gọi skill vào/sau giờ đó, hoặc dùng `RESPECT_SCHEDULE: false`. (Nếu cần auto định kỳ thật, chạy `register-task.ps1` để bật Scheduled Task — tùy chọn, không phải mặc định.)
- Mỗi học viên: 1 Base + 1 token riêng. Không dùng chung token giữa các Page khác nhau.

## File trong skill
- `scripts/post-reels-api.js` — ⭐ runner ON-DEMAND qua Lark Open API (không cần lark-cli). **Lệnh được chạy khi gọi skill.**

**Bộ chuyển giao học viên (`scripts/bo-cai/`):**
- `CAI-DAT.bat` — học viên bấm đúp để cài.
- `DANG-NGAY.bat` — bấm đúp để đăng các bài "Chờ đăng" (on-demand).
- `setup.ps1` — wizard cài đặt.
- `post-reels.js` — bộ máy đăng (engine).
- `init-app.js` — nạp app Lark (secret qua stdin).
- `run-reels.ps1` / `run-hidden.vbs` — wrapper chạy ẩn (chỉ dùng nếu bật Scheduled Task tùy chọn).
- `register-task.ps1` — *(tùy chọn, KHÔNG dùng ở chế độ on-demand)* đăng ký Scheduled Task 2 phút.
- `config.local.json` — wizard tự ghi (BASE_TOKEN/TABLE_ID/FB_*), template để trống.
- `_app.json` — ⚠️ ADMIN điền APP_SECRET (file nhạy cảm).
- `HUONG-DAN-HOC-VIEN.md` — gửi kèm học viên.
- `README-ADMIN.md` — nội bộ, KHÔNG gửi học viên.
