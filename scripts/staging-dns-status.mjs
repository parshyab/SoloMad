import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const terraformDir = join(root, "infra/terraform/environments/staging");
const terraformBin = join(root, "tools/terraform/terraform");
const aws = process.env.AWS_CLI ?? "aws";

function tfOutput(name) {
  const parsed = JSON.parse(execFileSync(terraformBin, ["output", "-json", name], { cwd: terraformDir, encoding: "utf8" }));
  return parsed?.value ?? parsed;
}

const nameservers = tfOutput("route53_name_servers") ?? [];
if (!Array.isArray(nameservers) || nameservers.length === 0) {
  console.log("route53_name_servers is empty; run make terraform-apply-staging with enable_public_edge=true first.");
  process.exit(1);
}
const parent = tfOutput("parent_route53_name_servers") ?? [];
if (Array.isArray(parent) && parent.length > 0) {
  console.log("Point solomad.app at your registrar to these Route 53 name servers (parent zone):");
  for (const ns of parent) console.log(`  - ${ns}`);
  console.log("After that propagates, staging.solomad.app is delegated automatically inside Route 53.");
} else {
  console.log("Delegate staging.solomad.app at your registrar to these Route 53 name servers:");
  for (const ns of nameservers) console.log(`  - ${ns}`);
}

const certs = JSON.parse(
  execFileSync(aws, ["acm", "list-certificates", "--certificate-statuses", "PENDING_VALIDATION", "ISSUED", "--no-cli-pager", "--output", "json"], {
    encoding: "utf8",
  }),
).CertificateSummaryList.filter((item) => item.DomainName?.includes("staging.solomad.app"));

for (const cert of certs) {
  const detail = JSON.parse(
    execFileSync(aws, ["acm", "describe-certificate", "--certificate-arn", cert.CertificateArn, "--no-cli-pager", "--output", "json"], {
      encoding: "utf8",
    }),
  ).Certificate;
  console.log(`ACM ${detail.DomainName}: ${detail.Status}`);
}
