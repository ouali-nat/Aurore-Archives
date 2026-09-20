import { Container, getContainer } from "@cloudflare/containers";

export class GotenbergContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";
  envVars = {
    GOTENBERG_CHROMIUM_AUTO_START: "true",
    GOTENBERG_CHROMIUM_MAX_CONCURRENCY: "2",
    GOTENBERG_CHROMIUM_MAX_QUEUE_SIZE: "20"
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null);
    if (!env.PDF_SERVICE_TOKEN || request.headers.get("x-pdf-service-token") !== env.PDF_SERVICE_TOKEN)
      return new Response("Unauthorized", {status:401});
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    const c = getContainer(env.GOTENBERG, "aurore-production");
    return c.fetch(new Request("http://container.local" + url.pathname + url.search, request));
  }
};
