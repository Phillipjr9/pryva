import type { Metadata } from "next";
import { ServicePageTemplate } from "@/components/site/ServicePageTemplate";
import { serviceMap } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Virtual numbers — buy or rent for OTP verification",
  description:
    "Buy a real non-VoIP virtual number from ₦1,200 or rent one for 7, 30 or 90 days. Instant delivery, Naira payment and automatic refunds if a code doesn't arrive.",
};

export default function VirtualNumbersPage() {
  return <ServicePageTemplate service={serviceMap.numbers} />;
}
