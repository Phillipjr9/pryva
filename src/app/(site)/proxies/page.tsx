import type { Metadata } from "next";
import { ServicePageTemplate } from "@/components/site/ServicePageTemplate";
import { serviceMap } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Residential proxies — Nigeria, US, UK and EU",
  description:
    "Ethically sourced residential proxy bandwidth with Nigerian, US, UK and EU exits. Rotating or sticky sessions, HTTP/SOCKS5, with Naira pricing from ₦3,500 per GB.",
};

export default function ProxiesPage() {
  return <ServicePageTemplate service={serviceMap.proxies} />;
}
