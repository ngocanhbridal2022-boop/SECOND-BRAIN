# dang-reel-facebook — chạy qua HTTP (GitHub Actions)

Đăng bài từ bảng Lark Base **"Đăng bài tự động"** lên Facebook Page, kích hoạt bằng 1 request HTTP.
Không cần bật máy, không cần Claude, không cần server riêng.

- Mỗi dòng tự chọn **Page** riêng qua cột link `Page` (trỏ tới bảng Page có Page ID + Page Token) → không cần 1 token cố định cho cả hệ thống.
- Cột `Loại`: **Hình ảnh** → đăng feed ảnh (`/photos` + `/feed`). **Video** → đăng **Reel thật** (`/video_reels`, upload phân mảnh, hiện trong tab Reels).
- Đăng xong tự cập nhật `Trạng thái` (Thành công/Thất bại), `Log`, `Link bài đăng`.

## 1. Khai báo Secret
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Giá trị |
|---|---|
| `LARK_APP_SECRET` | App Secret của app Lark (Developer Console → Credentials) |

Chỉ cần **1 secret duy nhất** — Page Token của từng Page đã nằm sẵn trong bảng Page trên Lark Base (script tự đọc qua Lark API bằng `LARK_APP_SECRET`), không cần khai riêng `FB_PAGE_TOKEN`.

## 2. Gọi chạy (HTTP)
```bash
curl -i -X POST https://api.github.com/repos/<USER>/<REPO>/dispatches \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"dang-reel","client_payload":{}}'
```
- PAT: GitHub → Settings → Developer settings → Personal access tokens → **classic**, scope `repo`.
- Trả về **HTTP 204** = đã nhận lệnh. Xem kết quả ở tab **Actions** của repo.
- Dán đúng request này vào action "Gửi yêu cầu HTTP" của Lark Automation (khi cột `Đăng` được điền) để tự động hoá.
- Mỗi lần gọi, script quét **toàn bảng** và đăng mọi dòng đủ điều kiện (`Trạng thái ≠ Thành công`, có Page + có file, đúng lịch nếu có) — không cần truyền record_id.

### Ghi đè giá trị không bí mật (tùy chọn)
```json
{
  "event_type": "dang-reel",
  "client_payload": {
    "lark_app_id": "cli_xxx",
    "lark_app_token": "base_token_xxx",
    "lark_table_id": "tbl_bang_dang_bai",
    "pages_table_id": "tbl_bang_page"
  }
}
```

## 3. Chạy tay để test (không cần HTTP)
Tab **Actions** → workflow **dang-reel** → **Run workflow** → tick "Chỉ liệt kê, không đăng thật" để dry-run trước.

## Lưu ý
- Page Token trong bảng Page hết hạn ~60 ngày → chạy lại `fetch-pages-to-lark.js --update` để làm mới, không cần sửa Secret/code.
- Bảng "Đăng bài tự động" cần các cột: `Page` (link), `Loại` (Hình ảnh/Video), `Nội dung`, `Comment ebook`, `Ảnh/video`, `Lịch đăng bài`, `Trạng thái`, `Log`, `Link bài đăng`.
- Engine chính: `dang-reel-facebook/scripts/post-feed-api.js`. Script `post-reels-api.js`/`fetch-pages-to-lark.js`/`fetch-posts-to-lark.js` là công cụ phụ trợ (đăng theo 1 Page cố định / đổ danh sách Page / đổ danh sách bài viết cũ).
- Tài liệu đầy đủ: `dang-reel-facebook/SKILL.md`.
