import { execFileSync } from "node:child_process";

const requested = process.env.SIMULATOR_UDID?.trim();
const listing = execFileSync("xcrun", ["simctl", "list", "devices", "available"], { encoding: "utf8" });

if (requested) {
  if (!listing.includes(requested)) {
    console.error(`SIMULATOR_UDID ${requested} is not an available simulator.`);
    process.exit(1);
  }
  process.stdout.write(requested);
  process.exit(0);
}

const preferred = deviceInRuntime(listing, "iOS 18.4", "iPhone 16");
if (preferred) {
  process.stdout.write(preferred);
  process.exit(0);
}

const created = createIphone16();
process.stdout.write(created);

function deviceInRuntime(text, runtime, name) {
  const sections = text.split(/^-- /m).filter(Boolean);
  const section = sections.find((part) => part.startsWith(runtime));
  const match = section?.match(new RegExp(`^\\s*${name} \\(([0-9A-F-]+)\\)`, "m"));
  return match?.[1] ?? "";
}

function createIphone16() {
  const json = execFileSync("xcrun", ["simctl", "list", "runtimes", "available", "-j"], { encoding: "utf8" });
  const runtimes = JSON.parse(json).runtimes ?? [];
  const runtime = runtimes.find((item) => item.isAvailable && item.version === "18.4");
  if (!runtime?.identifier) {
    console.error("No available iPhone 16 simulator exists, and the iOS 18.4 runtime is not installed.");
    process.exit(1);
  }
  return execFileSync(
    "xcrun",
    ["simctl", "create", "iPhone 16", "com.apple.CoreSimulator.SimDeviceType.iPhone-16", runtime.identifier],
    { encoding: "utf8" },
  ).trim();
}
