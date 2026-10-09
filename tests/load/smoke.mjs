const base = process.env.API_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";
const paths = ["/health", "/ready", "/v1/public/stats"];
let failed = 0;
for (const path of paths) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}${path}`);
    console.log(`${response.status} ${path} ${Date.now() - started}ms`);
    if (!response.ok) failed += 1;
  } catch (error) {
    failed += 1;
    console.log(`down ${path} ${error instanceof Error ? error.message : "failed"}`);
  }
}
if (failed) process.exit(1);
console.log("smoke finished; this is not a capacity result");
