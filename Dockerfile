FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./

RUN npm install

COPY . .

RUN DISABLE_ERD=true npx prisma generate

EXPOSE 6001

CMD ["sh", "-c", "npx prisma migrate deploy && node scripts/init-admin.js && npm start"]