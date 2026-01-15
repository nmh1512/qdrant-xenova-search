# Dockerfile
FROM node:20-slim

WORKDIR /app

# Install dependencies
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
