import { openApiDocument, routes } from "../packages/contracts/dist/index.js";

const document = openApiDocument();
const missing = routes.filter((route) => !document.paths[route.path]?.[route.method]);
if (missing.length) {
  console.error(missing.map((route) => `${route.method} ${route.path}`).join("\n"));
  process.exit(1);
}
console.log(`openapi paths ${Object.keys(document.paths).length}, operations ${routes.length}`);
