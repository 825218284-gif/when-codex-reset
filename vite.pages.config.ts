import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function githubPagesBase() {
  if (!process.env.GITHUB_ACTIONS) return "/";

  const [owner = "", repository = ""] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  if (!repository) return "/";
  return repository.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? "/"
    : `/${repository}/`;
}

export default defineConfig({
  root: "github-pages",
  base: githubPagesBase(),
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../pages-dist",
    emptyOutDir: true,
  },
});
