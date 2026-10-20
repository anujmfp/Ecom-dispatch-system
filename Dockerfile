# Lightweight Node.js 20 Alpine Linux image
FROM node:20-alpine

# Install build dependencies if needed
WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose server port
EXPOSE 3000

# Persistent storage volume for WhatsApp credentials and PDFs
VOLUME ["/app/storage"]

# Start DispatchPro server
CMD ["node", "server.js"]
