FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl bash

RUN curl -L https://raw.githubusercontent.com/noir-lang/noir/master/install.sh | bash && \
    export PATH="$HOME/.nargo/bin:$PATH"

ENV PATH="/root/.nargo/bin:$PATH"

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001

CMD ["npm", "run", "server"]
