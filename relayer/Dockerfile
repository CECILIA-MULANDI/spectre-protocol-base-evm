FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl bash wget

# Download and install nargo directly
RUN mkdir -p /root/.nargo/bin && \
    wget -q https://github.com/noir-lang/noir/releases/download/v0.36.0/nargo-x86_64-linux-gnu.tar.gz && \
    tar -xzf nargo-x86_64-linux-gnu.tar.gz -C /root/.nargo/bin && \
    rm nargo-x86_64-linux-gnu.tar.gz && \
    chmod +x /root/.nargo/bin/nargo && \
    /root/.nargo/bin/nargo --version

ENV PATH="/root/.nargo/bin:${PATH}"
ENV NARGO_PATH="/root/.nargo/bin/nargo"

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001

CMD ["npm", "run", "server"]
