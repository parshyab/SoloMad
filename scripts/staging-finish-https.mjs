import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const aws = process.env.AWS_CLI ?? "aws";
const region = process.env.AWS_REGION ?? "us-east-1";
const terraformDir = join(root, "infra/terraform/environments/staging");
const terraformBin = join(root, "tools/terraform/terraform");

const arn = JSON.parse(
  execFileSync(
    aws,
    ["acm", "list-certificates", "--certificate-statuses", "ISSUED", "PENDING_VALIDATION", "--region", region, "--no-cli-pager", "--output", "json"],
    { encoding: "utf8" },
  ),
).CertificateSummaryList.find((item) => item.DomainName === "api.staging.solomad.app")?.CertificateArn;

if (!arn) {
  console.error("no ACM certificate found for api.staging.solomad.app");
  process.exit(1);
}

for (let attempt = 1; attempt <= 40; attempt += 1) {
  const status = execFileSync(aws, ["acm", "describe-certificate", "--certificate-arn", arn, "--region", region, "--no-cli-pager", "--query", "Certificate.Status", "--output", "text"], {
    encoding: "utf8",
  }).trim();
  console.log(`ACM status: ${status} (check ${attempt}/40)`);
  if (status === "ISSUED") {
    execFileSync(terraformBin, ["apply", "-input=false", "-auto-approve", "-var=enable_https_listener=true"], {
      cwd: terraformDir,
      stdio: "inherit",
      env: process.env,
    });
    console.log("HTTPS listener enabled on the staging ALB");
    process.exit(0);
  }
  execFileSync("sleep", ["30"]);
}
console.error("ACM certificate is still not ISSUED; delegate solomad.app NS at your registrar (make staging-dns-status).");
process.exit(1);
