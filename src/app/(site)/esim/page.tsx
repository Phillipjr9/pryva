import type { Metadata } from "next";
import { ServicePageTemplate } from "@/components/site/ServicePageTemplate";
import { serviceMap } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "eSIM data for travel — 190+ destinations",
  description:
    "Buy an eSIM in Naira and land connected. Regional and country data bundles across 190+ destinations, delivered as a QR code in your Pryva dashboard.",
};

export default function EsimPage() {
  return <ServicePageTemplate service={serviceMap.esim} />;
}
