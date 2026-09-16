# Quy trình AI

Chưa có mô hình AI đã huấn luyện trong ứng dụng. Chỉ số trên website là công thức minh họa, không gọi mô hình này. Không tạo nhãn ngập giả từ lượng mưa để báo cáo độ chính xác.

## Dữ liệu cần thu thập

CSV có các cột: `event_id,time,site_id,rain_1h_mm,rain_3h_mm,elevation_m,impervious_fraction,distance_drain_m,flooded`.

- `time`: thời gian ISO 8601 có múi giờ, ví dụ `2025-09-30T10:00:00+07:00`.
- `event_id`: cùng một trận mưa/sự kiện phải dùng chung mã ở tất cả vị trí; có cả các sự kiện không gây ngập.
- `site_id`: mã vị trí khảo sát được xác minh trong ranh giới phường.
- Mưa 1h và 3h là tổng cửa sổ kết thúc tại `time`, đơn vị mm; 3h bao gồm giờ cuối.
- `elevation_m`: cao độ từ nguồn thống nhất; ghi riêng nguồn và hệ cao độ.
- `impervious_fraction`: tỷ lệ bề mặt không thấm trong vùng đệm đã định nghĩa, 0–1.
- `distance_drain_m`: khoảng cách đến đối tượng thoát nước được định nghĩa và kiểm tra thống nhất.
- `flooded`: 1 có ngập, 0 xác nhận không ngập. Không coi thiếu báo cáo là không ngập. Chốt ngưỡng độ sâu, cách đo và thời điểm gán nhãn trong đề cương.

Tối thiểu phần mềm yêu cầu 5 sự kiện độc lập; nghiên cứu có thể cần nhiều hơn đáng kể. Tách khoảng 80% sự kiện sớm để huấn luyện, 20% muộn để kiểm tra; không chia ngẫu nhiên từng dòng của cùng trận mưa. Script từ chối sự kiện chồng lấn qua mốc chia hoặc tập chỉ có một lớp.

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r ml/requirements.txt
.venv\Scripts\python ml/train.py data/observations.csv
```

Đầu ra: `ml/artifacts/flood-model.joblib` và `evaluation.json`, gồm precision, recall, F1, confusion matrix, average precision và baseline không ngập. Chỉ nạp file joblib do mình tạo và tin cậy.

Mô hình hiện là phân loại ngập hồi cứu. Để dự báo trước 1–3 giờ: định nghĩa thời điểm phát hành t, nhãn tại t+h, và chỉ sử dụng biến có sẵn tại t (bao gồm dự báo mưa lưu trữ theo thời điểm phát hành). Không dùng mưa thực tế tương lai hoặc tái phân tích tương lai làm đặc trưng dự báo. Cần kiểm định thêm theo vị trí, calibration, tỷ lệ bỏ sót/cảnh báo giả và thời gian báo trước trước khi đưa xác suất AI lên web. Chưa triển khai API suy luận khi chưa có mô hình đạt kiểm định.
