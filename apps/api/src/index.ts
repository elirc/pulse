import { buildApiServer, env } from "./server";

const app = buildApiServer();
app
  .listen({ port: env.API_PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`pulse api on :${env.API_PORT}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
