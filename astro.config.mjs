import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  adapter: cloudflare({ imageService: "passthrough" }),
  output: "server",
  session: false,
  vite: {
    server: {
      watch: { ignored: ["**/.wrangler/**", "**/test-results/**", "**/playwright-report/**"] },
    },
  },
});
