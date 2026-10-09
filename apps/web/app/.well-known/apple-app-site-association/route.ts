import { associationDocument } from "../../../lib/association";

export function GET() {
  const document = associationDocument(process.env.APPLE_TEAM_ID);
  if (!document) {
    return Response.json({ error: "associated_domain_unconfigured" }, { status: 404 });
  }
  return Response.json(document);
}
