# dang-reel-facebook — chạy qua HTTP (GitHub Actions)

Đăng Reel từ Lark Base lên Facebook Page, kích hoạt bằng 1 request HTTP.
Không cần bật máy, không cần Claude, không cần server riêng.

## 1. Khai báo Secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Giá trị |
|---|---|
| `LARK_APP_SECRET` | App Secret của app Lark (Developer Console → Credentials) |
| `FB_PAGE_TOKEN` | Facebook Page Access Token dài hạn (`pages_manage_posts`, `pages_read_engagement`, `pages_show_list`) |

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
- Dán đúng request này vào action "Gửi yêu cầu HTTP" của Lark Base để tự động hoá.

### Ghi đè giá trị không bí mật (tùy chọn)
Truyền qua `client_payload` nếu muốn dùng Base/Page khác với default trong script:
```json
{
  "event_type": "dang-reel",
  "client_payload": {
    "lark_app_id": "cli_xxx",
    "lark_app_token": "base_token_xxx",
    "lark_table_id": "tbl_xxx",
    "fb_page_id": "1234567890",
    "trigger": "Chờ đăng"
  }
}
```

## 3. Chạy tay để test (không cần HTTP)
Tab **Actions** → workflow **dang-reel** → **Run workflow** → tick "Chỉ liệt kê, không đăng thật" để dry-run trước.

## Lưu ý
- FB Page Token hết hạn ~60 ngày → chỉ cập nhật lại Secret, không sửa code.
- Base Lark cần bảng có các cột: `TT Reel`, `Ảnh/video`, `Nội dung`, `Hastag`, `Lịch đăng`, `Link Reel`, `Log đăng Reel`, `Comment ebook`.
- Engine gốc + tài liệu đầy đủ nằm ở `dang-reel-facebook/SKILL.md`.
