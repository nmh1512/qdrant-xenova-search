# Tài liệu Triển khai Hệ thống Semantic Search (MySQL + Qdrant)

Hệ thống này cho phép tìm kiếm ứng viên dựa trên ý nghĩa ngữ nghĩa (semantic search) thay vì chỉ tìm kiếm từ khóa chính xác, sử dụng cơ sở dữ liệu vector Qdrant và mô hình embedding nội bộ.

## 📋 Yêu cầu hệ thống

- **Node.js**: v18+
- **Docker & Docker Compose**: Để chạy Qdrant
- **MySQL**: Cơ sở dữ liệu hiện tại (Laragon, XAMPP, hoặc Docker)
- **RAM**: Tối thiểu 4GB (để chạy mô hình AI nội bộ)

## 🛠️ Cấu trúc dự án

- `/app/server.js`: Web server Express & SSR giao diện Tìm kiếm.
- `/app/ingest.js`: Script đồng bộ dữ liệu từ MySQL vào Qdrant.
- `/app/embedding.js`: Xử lý tạo vector từ văn bản bằng mô hình `all-MiniLM-L6-v2`.
- `/app/qdrant.js`: Cấu hình kết nối và khởi tạo Collection trong Qdrant.

## 🚀 Các bước triển khai

### Bước 1: Cài đặt Dependencies
Mở terminal tại thư mục dự án và chạy:
```bash
npm install
```

### Bước 2: Cấu hình biến môi trường
Tạo hoặc chỉnh sửa file `.env` ở thư mục gốc với thông tin MySQL của bạn:
```env
# Cấu hình MySQL (Thay đổi cho đúng với DB của bạn)
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=your_database_name

# Cấu hình Qdrant & App
QDRANT_URL=http://localhost:6333
PORT=3000
```

### Bước 3: Khởi động Qdrant Vector Database
Sử dụng Docker Compose để chạy Qdrant:
```bash
docker-compose up -d
```
*Lưu ý: Qdrant sẽ chạy tại cổng 6333.*

### Bước 4: Đồng bộ dữ liệu (MySQL -> Qdrant)
Chạy script để chuyển 5000 bản ghi ứng viên sang dạng vector và lưu vào Qdrant:
```bash
node app/ingest.js
```
- Script này sẽ tự động kết nối MySQL, lấy dữ liệu bảng `users`, `user_candidates`, `user_candidate_search`.
- Nó sẽ tạo vector 384 chiều cho mỗi ứng viên.

### Bước 5: Chạy ứng dụng Web
Khởi động giao diện tìm kiếm:
```bash
node app/server.js
```
Truy cập tại: [http://localhost:3000](http://localhost:3000)

## 🔍 Cách hoạt động của Tìm kiếm ngữ nghĩa

1. **Embedding**: Khi bạn nhập một câu hỏi (vd: "Tìm chuyên gia React biết tiếng Anh"), hệ thống dùng mô hình `Xenova/all-MiniLM-L6-v2` chuyển câu đó thành một chuỗi 384 con số (Vector).
2. **Vector Search**: Qdrant so sánh vector này với 5000 vector ứng viên đã lưu trong DB bằng thuật toán `Cosine Similarity`.
3. **Kết quả**: Hệ thống trả về những ứng viên có "ý nghĩa" gần nhất với yêu cầu của bạn, ngay cả khi họ không ghi đúng từ khóa trong hồ sơ.

## ⚠️ Lưu ý quan trọng
- **Lần đầu chạy**: Hệ thống sẽ tải mô hình AI từ HuggingFace về thư mục bộ nhớ đệm (khoảng 80MB). Các lần sau sẽ chạy offline hoàn toàn.
- **Dung lượng**: Nếu bạn có hàng triệu bản ghi, nên cân nhắc nâng cấp RAM cho Qdrant để lưu trữ index vector.

## 🐳 Triển khai bằng Docker hoàn toàn
Nếu bạn muốn đóng gói cả App vào Docker, chỉ cần chạy:
```bash
docker-compose build
docker-compose up -d
```
