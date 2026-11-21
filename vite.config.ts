import { defineConfig } from "vite";

// BASE is the path the site is served from: "/" locally, "/four-site/" on
// GitHub Pages (set by the deploy workflow).
export default defineConfig({
  base: process.env.BASE ?? "/",
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 900 }, // three.js is most of it
});
