FROM node:22-alpine AS build
ARG APP
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ui/package.json packages/ui/package.json
COPY apps/media/package.json apps/media/package.json
COPY apps/files/package.json apps/files/package.json
RUN npm ci
COPY packages/ui packages/ui
COPY apps/${APP} apps/${APP}
RUN npm run build -w @cloud-at-home/${APP}

FROM nginx:1.27-alpine
ARG APP
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/${APP}/dist /usr/share/nginx/html
EXPOSE 80
