import { createApp } from "../app.js";

const app = createApp();
const job = process.argv[2];
if (job === "prices") console.log(await app.runPriceSync());
else if (job === "orders") console.log(await app.runOrderSync());
else if (job === "messages") console.log(await app.runMessageSync());
else {
  console.error("usage: tsx src/jobs/cli.ts prices|orders|messages");
  process.exit(1);
}
