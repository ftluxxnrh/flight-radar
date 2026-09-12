import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Render 등 배포 환경에서는 DATABASE_URL 환경변수를 읽고,
 * 값이 없으면 샌드박스 기본 주소로 폴백한다.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  },
});
