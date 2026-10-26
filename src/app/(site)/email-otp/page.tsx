import type { Metadata } from "next";
import { ServicePageTemplate } from "@/components/site/ServicePageTemplate";
import { serviceMap } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Temporary email OTP — private inboxes in Naira",
  description:
    "Create a temporary email address for signups and verification codes. Live OTP view, isolated inboxes, 24-hour or 30-day retention, paid in Naira from ₦700.",
};

export default function EmailOtpPage() {
  return <ServicePageTemplate service={serviceMap["email-otp"]} />;
}
