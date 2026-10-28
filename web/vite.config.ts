import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the built folder works from any static host or sub-path.
export default defineConfig({ base: "./", plugins: [react()] });
