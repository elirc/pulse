import { buildIngestServer, env } from "./server";

const app = buildIngestServer();
app
  .listen({ port: env.INGEST_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse ingest on :${env.INGEST_PORT} — POST /e`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
