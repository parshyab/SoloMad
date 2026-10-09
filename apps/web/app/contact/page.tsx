import { LegalDraft } from "../legal-draft";

export default function ContactPage() {
  const contact = process.env.LEGAL_CONTACT_EMAIL ?? "";
  const published = contact.length > 0 && !contact.endsWith(".invalid") && !contact.includes("example");
  return (
    <LegalDraft title="Contact">
      <p>
        {published
          ? `Operator contact: ${contact}`
          : "Operator contact is not configured. Set LEGAL_CONTACT_EMAIL to a real address before publishing this page."}
      </p>
    </LegalDraft>
  );
}
