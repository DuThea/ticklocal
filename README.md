# TickLocal v4.0

Việc, lịch, thói quen, Pomodoro và ma trận Eisenhower trong một web app chạy hoàn toàn trên máy. Không tài khoản, không máy chủ, không AI.

## Chạy trên máy (Windows, PowerShell)

```powershell
npm install
npm run dev        # mở http://localhost:5173
npm test           # 23 unit test cho lõi, tự chạy theo giờ Việt Nam
npm run build      # tạo thư mục dist/ để đưa lên mạng
npm run preview    # xem thử bản build (service worker chỉ bật ở bản build)
```

## Đưa lên mạng và cài lên iPhone

**GitHub Pages (miễn phí, repo phải để public):** đẩy code lên nhánh `main`, vào Settings → Pages → Source chọn **GitHub Actions**. File `.github/workflows/deploy.yml` tự chạy test, build và đăng app lên `https://<tên-github>.github.io/<tên-repo>/`. Đường dẫn con được truyền qua biến `BASE_PATH`, nên không cần sửa `vite.config.js`.

**Netlify:** tạo site từ repo; `netlify.toml` đã khai báo sẵn lệnh build và thư mục `dist`.

Mỗi địa chỉ có kho dữ liệu riêng. Đổi nơi đăng app thì xuất JSON ở địa chỉ cũ rồi nhập ở địa chỉ mới.

1. Trên iPhone, mở địa chỉ app bằng Safari → Chia sẻ → **Thêm vào Màn hình chính**.
2. Từ đó chỉ mở bằng biểu tượng. Dữ liệu của biểu tượng và của tab Safari là hai kho riêng.
3. Vào tab Dữ liệu → **Nhập JSON** → chọn `TickLocal_KhoiDau_v4.json` để có sẵn danh sách, thẻ, bộ lọc, thói quen cho ba mảng việc.

Mỗi lần phát hành bản mới, tăng số trong `CACHE` ở `public/sw.js` để máy người dùng nhận bản mới.

## Cấu trúc

| File | Vai trò |
| --- | --- |
| `src/core.js` | Lõi thuần: ngày tháng, parser nhập nhanh, bộ lặp, normalize, reducer, thống kê, xuất .ics. Không đụng DOM hay lưu trữ. |
| `src/storage.js` | IndexedDB: mỗi bản ghi một dòng, mỗi lần lưu chỉ ghi phần thay đổi. Tự chuyển dữ liệu từ v3/v2 trong localStorage. |
| `src/App.jsx` | Giao diện React. |
| `public/` | Manifest, service worker, biểu tượng. |
| `tests/core.test.mjs` | Unit test cho lõi (`node --test`, không cần thư viện). |

## Thay đổi so với v3

Mỗi mục ứng với một lỗi trong bản đánh giá sau giả lập 3 năm.

| Vấn đề ở v3 | v4 |
| --- | --- |
| Lặp hàng tháng ngày 31 trôi về 28 mãi mãi | Lưu ngày gốc: 31/01 → 28/02 → 31/03. Dời hạn tạm ("Dời sang mai") không đổi ngày gốc. |
| "Backtest 2h" thành hạn 02:00 hôm nay | "9h" trần là thời lượng; chỉ là giờ khi có phút (9h30, 14:30), có "lúc", hoặc có sáng/trưa/chiều/tối/đêm. |
| "1/2 viên" thành ngày 1/2 | 1/2, 1/3, 2/3, 1/4, 3/4 là phân số, trừ khi viết "ngày 1/2" hoặc có năm. |
| Tiêu đề ghi chú bị cắt mất "mai", "9h" | Ghi chú không chạy parser. |
| Quên tắt đếm xuôi → phiên 568 phút | Phiên trên 3 giờ phải xác nhận, nhập được số phút thật; xoá được từng phiên. |
| Không biết lần sao lưu gần nhất | Ghi ngày xuất file; băng nhắc khi quá 7 ngày. |
| Safari có thể xoá dữ liệu sau 7 ngày | Có manifest và service worker để cài lên Màn hình chính; mở được khi mất mạng; xin quyền lưu trữ lâu dài. |
| Trần localStorage ~5 MB, đứng 356 ms mỗi lần lưu ở năm 3 | IndexedDB, ghi từng bản ghi; không còn tác vụ nào dài quá 50 ms khi lưu. |
| Dữ liệu tăng mãi | Nút "Lưu trữ việc cũ": xuất việc đã xong và phiên tập trung cũ hơn 12 tháng ra file riêng rồi gỡ khỏi app; tổng số vẫn giữ. |
| Checklist "mỗi ngày" quá hạn mọi cuối tuần | Kiểu lặp "Ngày thường (T2–T6)" và "Mỗi N ngày/tuần/tháng". Gõ được: `ngày thường`, `thứ 2-6`, `mỗi 2 tuần`. |
| Gõ nhầm thẻ là sinh thẻ rác (55 thẻ sau 3 năm) | Hỏi trước khi tạo thẻ mới, gợi ý thẻ gần giống (bỏ dấu, sai ≤ 2 ký tự). Gộp thẻ trong màn hình sửa thẻ. |
| Không dời hạn nhanh, không nhân bản | Nút Hôm nay / Dời sang mai / +7 ngày, Nhân bản, Chuyển việc ↔ ghi chú. |
| Thói quen ngày thường đứt chuỗi mỗi cuối tuần | Chọn ngày trong tuần cho từng thói quen; chuỗi và tỷ lệ tính theo lịch đó. |
| Tìm kiếm chỉ trong mục đang mở | Mặc định tìm toàn bộ, gồm ghi chú; có nút thu hẹp. |
| Không biết giờ tập trung đi về đâu | Báo cáo tuần/tháng có giờ tập trung theo danh sách. |
| Không có nhắc giờ | Băng nhắc + tiếng bíp + thông báo hệ thống khi app đang mở; xuất việc sang app Lịch (.ics) để iPhone nhắc cả khi app đóng. |
| Nút Hoàn tác mất khi có thông báo mới; hoàn tác xoá luôn việc làm sau đó | Nút sống 8 giây độc lập với thông báo; chỉ đảo đúng thao tác đó. |
| Gõ tiêu đề khựng khi dữ liệu lớn | Tiêu đề, mô tả gõ vào bản nháp, ghi sau 300 ms. |
| Xoá số trong ô cài đặt là nhảy về 1 | Ô số chỉ kẹp giá trị khi rời ô. |
| "Đặt lại" xoá sạch rồi nạp dữ liệu mẫu | Tách thành "Xoá trắng" và "Dữ liệu mẫu". |

## Số đo (giả lập 3 năm, cùng một người dùng mẫu)

Chromium giả lập màn hình 390×844, CPU giảm tốc 4 lần, bản build production. Không phải iPhone thật.

| Năm thứ 3 | v3 | v4 | v4 có lưu trữ hằng tháng |
| --- | --- | --- | --- |
| Mở app (ms) | 528 | 750 | 625 |
| Giao diện đứng mỗi lần lưu (ms) | 356 | dưới 50 | dưới 50 |
| Thêm việc (ms) | 48 | 48 | 32 |
| Gõ tiêu đề, mỗi ký tự (ms) | 64 | 40 | 48 |
| Gõ tìm kiếm, mỗi ký tự (ms) | 40 | 96 | — |
| Dung lượng dữ liệu (triệu ký tự) | 4,19 | 4,64 | 2,42 |
| Phần đã dùng của hạn mức | 80% của ~5 MB | 5 MB / 2 GB (Chromium) | 2,6 MB / 2 GB |
| Việc bị đặt giờ sai do "2h" | 402 | 0 | 0 |
| Số thẻ (người dùng tạo 7) | 62 | 7 | 7 |
| Kiểm tra toàn vẹn | 0 lỗi | 0 lỗi | 0 lỗi |

Mở app chậm hơn v3 vì IndexedDB đọc từng bản ghi thay vì một chuỗi JSON. Tìm kiếm chậm hơn vì giờ tìm cả nội dung ghi chú; kết quả được tính sau khi gõ nên ô nhập không khựng.

## Giới hạn đã biết

- Chưa thử trên iPhone thật: hạn mức IndexedDB, thông báo hệ thống và tiếng nền khi khoá máy trên iOS có thể khác.
- Nhắc giờ khi app đóng chỉ có qua app Lịch (.ics). Thông báo đẩy thật cần máy chủ, trái nguyên tắc của app.
- Ở năm thứ 3, mỗi lần lưu vẫn duyệt cả mảng việc để tìm bản ghi đã đổi (vài ms). Lưu trữ hằng tháng giữ con số này nhỏ.
- `npm run build` chưa chạy được trong môi trường phát triển (không có mạng để cài Vite); bản thử nghiệm được dựng bằng esbuild từ cùng mã nguồn.
