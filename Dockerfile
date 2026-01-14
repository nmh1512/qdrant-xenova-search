# Sử dụng image có sẵn CUDA từ NVIDIA
FROM nvidia/cuda:12.2.0-base-ubuntu22.04

# Cài đặt Node.js
RUN apt-get update && apt-get install -y curl
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get install -y nodejs

WORKDIR /app

# Cài đặt các thư viện hệ thống cần cho ONNX Runtime GPU
RUN apt-get update && apt-get install -y libgomp1

# Cài đặt dependencies
COPY package*.json ./
RUN npm install

# Pre-download model
COPY download_model.js ./
RUN node download_model.js

# Copy application code
COPY . .

# Set environment variables
ENV PORT=3000
ENV QDRANT_URL=http://qdrant:6333
ENV NODE_ENV=production

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "app/server.js"]
