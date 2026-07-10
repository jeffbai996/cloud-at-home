import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8079" } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("monaco-editor")) return "monaco";
          if (id.includes("pdfjs-dist")) return "pdf";
          if (id.includes("motion")) return "motion";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
});
