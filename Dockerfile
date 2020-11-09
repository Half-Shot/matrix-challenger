# Stage 0: Build the thing
FROM node:14-alpine AS builder

COPY . /src
WORKDIR /src

RUN yarn
RUN yarn build

# Stage 1: The actual container
FROM node:14-alpine

COPY --from=builder /src/lib/ /bin/matrix-challenger/
COPY --from=builder /src/package*.json /bin/matrix-challenger/
COPY --from=builder /src/yarn.lock /bin/matrix-challenger/
WORKDIR /bin/matrix-challenger
RUN yarn --production

VOLUME /data
EXPOSE 9993
EXPOSE 7775

CMD ["node", "/bin/matrix-challenger/App.js"]
