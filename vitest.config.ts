import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      DATABASE_PATH: "./data/aliproxy.test.db",
      PROXY_API_KEY: "aliproxy-local-key",
      ENCRYPTION_KEY: "33dd0818808d37ef39db48ca19b4287a1cb45837f7c1d217248197ed501f45a8",
    },
  },
});
