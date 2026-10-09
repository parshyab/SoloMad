// Quote-aware dotenv reader. Values are not shell-expanded, so `$` and `@` stay literal.

export function parseDotenv(text) {
  const values = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    values[key] = value;
  }
  return values;
}

export function assertDotenvParser() {
  const parsed = parseDotenv('QUOTED="name@host"\nSPECIAL="p@ss$"\nLITERAL=$HOME\nEMPTY=\n# hidden\n');
  if (parsed.QUOTED !== "name@host" || parsed.SPECIAL !== "p@ss$" || parsed.LITERAL !== "$HOME" || parsed.EMPTY !== "") {
    throw new Error("dotenv parser failed its quote and literal checks");
  }
}
