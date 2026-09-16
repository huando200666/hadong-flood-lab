# Hà Đông Flood Lab

Website nghiên cứu GIS và AI về ngập úng tại **phường Hà Đông, Hà Nội**. Giao diện tiếng Việt, hỗ trợ màn hình điện thoại. Node.js 20+; web không cần cài thư viện npm.

## Mở website

**Cách dễ nhất trên Windows:** nhấp đúp `start.cmd`. Máy chủ chạy nền và trình duyệt mặc định tự mở website. Nếu máy chủ đã chạy, tệp chỉ mở lại website. Có thể đóng cửa sổ khởi động; máy chủ tiếp tục chạy đến khi tắt máy. Không cần nhập lệnh. Nếu muốn tự quản lý và dừng máy chủ bằng Ctrl+C, dùng cách thủ công dưới đây (khi chưa chạy nền).

Trong thư mục dự án chạy:

```powershell
node server.mjs
```

Mở **http://localhost:3000**. Dừng bằng Ctrl+C. Cần Internet để tải bản đồ nền, Leaflet và thời tiết. Máy chủ chỉ lắng nghe trên máy cá nhân, chưa triển khai công khai.

## Đã triển khai

- Bản đồ Leaflet/OpenStreetMap, 3 điểm tham chiếu khu vực có tư liệu về ảnh hưởng ngập; bật/tắt điểm, chọn vị trí, về trung tâm.
- Backend lấy Open-Meteo, có timeout và cache 15 phút. Dự báo 24 giờ tới tại một điểm đại diện (20.9708, 105.7788); biểu đồ, bảng, xuất JSON. Thời gian UTC+7.
- Khi thiếu mạng/dữ liệu hiển thị lỗi rõ ràng, không giả dữ liệu thời gian thực, không chuyển thiếu mưa thành 0.
- Kịch bản mưa và chỉ số thử nghiệm có công thức công khai, kèm gợi ý ứng phó.
- Danh mục nguồn và script tải mưa lịch sử 2025 (ERA5) cùng dự báo hiện hành.
- Mã huấn luyện Random Forest bằng dữ liệu ngập được xác minh, tách sự kiện theo thời gian; xem `ml/README.md`.

```powershell
node scripts/download-data.mjs
node --test tests/risk.test.mjs
```

`data/rainfall-history-2025.json` là dữ liệu tái phân tích, không phải trạm đo; `data/weather-forecast.json` là ảnh chụp dữ liệu tại thời điểm tải. Web dùng API hiện hành, không lặng lẽ dùng ảnh chụp cũ. Metadata lưu URL và thời gian tải. Nếu API lỗi, chạy lại script khi có mạng.

## Những gì CHƯA thể kết luận

Chưa có mô hình AI được huấn luyện, bản đồ phạm vi/độ sâu ngập, ranh giới phường đã xác minh hoặc hệ thống cảnh báo vận hành. Không hiển thị độ chính xác hay xác suất ngập khi chưa có kiểm định. Điểm tham chiếu do người phát triển chọn để đặt tên khu vực lên bản đồ, không phải tọa độ hộ di tản. Không dùng toàn bộ quận Hà Đông cũ làm ranh giới phường hiện nay.

Mưa đại diện một ô mô hình không đủ phân giải để phân biệt nguy cơ giữa các phố. Chỉ số thử nghiệm không xét dòng chảy, địa hình hay mạng thoát nước. Copernicus DEM mới là nguồn đề xuất, chưa tải; DSM khoảng 30 m không thay thế cao độ đường/cống.

## Lộ trình hoàn thiện đề tài

1. Xin lớp ranh giới chính thức và xác minh phạm vi nghiên cứu trong QGIS.
2. Xin/khảo sát cao độ, cống, trạm bơm, mặt phủ, mưa và mực nước; lưu nguồn, thời gian, hệ tọa độ và quyền sử dụng.
3. Thu thập nhiều sự kiện độc lập: tọa độ, thời gian, độ sâu, thời gian rút và các mẫu **xác nhận không ngập**.
4. Huấn luyện baseline và Random Forest; đánh giá theo thời gian và vị trí, precision/recall/F1, cảnh báo giả/bỏ sót; không rò rỉ sự kiện giữa các tập.
5. Xây bộ dữ liệu dự báo theo thời điểm phát hành cho horizon 1–3 giờ, hiệu chỉnh xác suất, đánh giá báo trước. Chỉ sau đó tích hợp API AI và thống nhất ngưỡng cảnh báo với chuyên gia/địa phương.

## Tệp chính

`public/`: giao diện và logic; `server.mjs`: máy chủ/API; `data/`: GeoJSON tham chiếu và nguồn; `scripts/`: tải dữ liệu; `ml/`: huấn luyện; `tests/`: kiểm tra logic thiếu dữ liệu, múi giờ và cửa sổ mưa.

Nguồn xem `data/sources.json`. Ghi công OpenStreetMap contributors và Open-Meteo trên web. Tuân thủ điều khoản nhà cung cấp khi triển khai rộng; không tải hàng loạt tile OSM. Đây là công cụ nghiên cứu, không thay thế thông báo của cơ quan chức năng.

## Cập nhật trải nghiệm dự báo

Chọn biểu đồ 6/12/24 giờ, xem tổng mưa và giờ mưa lớn nhất, xuất CSV theo khoảng đang chọn, in/lưu PDF bằng trình duyệt. Có thể nạp giờ mưa dự báo lớn nhất vào kịch bản thử nghiệm; chỉ số vẫn chưa phải mô hình AI đã kiểm định. Dữ liệu tự cập nhật mỗi 15 phút khi tab đang hiển thị. API dùng chung một yêu cầu nguồn cho các lượt truy cập đồng thời.

Chạy toàn bộ kiểm tra: `node --test tests/*.test.mjs`.
