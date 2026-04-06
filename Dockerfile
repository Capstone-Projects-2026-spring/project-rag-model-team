# Use official Node.js LTS image
FROM node:20

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy app source code
COPY . .

# Expose port (change if your app uses a different port)
EXPOSE 3000

# Start the app (change if your entry point is different)
CMD ["node", "index.js"]
