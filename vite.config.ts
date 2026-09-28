import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // caminhos relativos: funciona na raiz do domínio ou numa subpasta (ex.: HostGator)
  base: "./",
});
