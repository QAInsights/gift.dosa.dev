import { defineMiddleware } from "astro:middleware";

const PROTECTED = ["/cabinet", "/cards", "/account", "/file", "/api"];

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const path = context.url.pathname;
  if (path === "/" || PROTECTED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "same-origin");
  }
  return response;
});
