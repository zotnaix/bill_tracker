// vite.config.ts
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
// ... other imports

export default defineConfig({
  plugins: [
    // ... other plugins like tsconfig paths
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
  ],
});