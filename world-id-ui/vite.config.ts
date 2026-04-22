import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "wasm-mime-type",
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          if (_req.url?.endsWith(".wasm")) {
            res.setHeader("Content-Type", "application/wasm");
          }
          next();
        });
      },
    },
  ],
  optimizeDeps: {
    exclude: ["@worldcoin/idkit-core"],
  },
});
