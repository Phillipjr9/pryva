import { describe, expect, it } from "vitest";
import { demoService } from "@/lib/demo-services";
import { demoServicePresentation } from "@/lib/demo-service-presentation";
import { demoServiceTerms } from "@/lib/demo-service-catalog";
import { buildServiceExplorer } from "@/lib/service-explorer";

function display(id: string, country = "ng") {
  const selection = demoService(id, country);
  expect(selection, `${id} in ${country}`).not.toBeNull();
  const result = demoServicePresentation(selection!);
  expect(result, `${id} in ${country}`).not.toBeNull();
  return result!;
}

function fact(result: ReturnType<typeof display>, label: string) {
  return result.facts.find((entry) => entry.label === label)?.value;
}

describe("selected demo service presentation", () => {
  it("has an explicit experience for every purchasable item in representative countries", () => {
    for (const country of ["ng", "us", "gb", "de", "bj"]) {
      for (const item of buildServiceExplorer(country).filter((entry) => demoServiceTerms(entry))) {
        const result = display(item.id, country);
        expect(result.category).toBeTruthy();
        expect(result.deliveryTitle).toBeTruthy();
        expect(result.checkoutSummary).toBeTruthy();
      }
    }
  });

  it("keeps the chosen app, promotion type, quantity and country distinct", () => {
    const verification = display("verification-whatsapp", "gb");
    expect(fact(verification, "App")).toBe("WhatsApp");
    expect(fact(verification, "Selected country")).toBe("United Kingdom");
    expect(verification.deliveryDescription).toContain("fictional number");
    const followers = display("social-instagram-followers");
    const views = display("social-youtube-views");
    expect(fact(followers, "Platform")).toBe("Instagram");
    expect(fact(followers, "Promotion")).toBe("Followers");
    expect(fact(followers, "Package")).toBe("100 demo followers");
    expect(fact(views, "Platform")).toBe("YouTube");
    expect(fact(views, "Promotion")).toBe("Views");
    expect(views.deliveryDescription).toContain("No profile is contacted");
  });

  it("explains the selected number, inbox, eSIM, proxy and network plans without implying live delivery", () => {
    expect(display("plan-rent-ng-7").deliveryDescription).toContain("same fictional number");
    expect(display("plan-vn-otp-5").checkoutSummary).toBe("5 demo verifications");
    expect(display("plan-email-team").deliveryDescription).toContain("next inbox and code");
    const esim = display("plan-esim-europe", "us");
    expect(fact(esim, "Catalog region")).toBe("Europe (38 countries)");
    expect(fact(esim, "Selected country")).toBe("United States");
    expect(esim.deliveryDescription).toContain("cannot activate");
    const proxy = display("plan-proxy-ng-5");
    expect(fact(proxy, "Plan")).toBe("5GB · Nigeria");
    expect(proxy.deliveryDescription).toContain("cannot be used as a real proxy");
    const data = display("data-airtel-1gb");
    expect(fact(data, "Network")).toBe("Airtel");
    expect(fact(data, "Data")).toBe("1GB");
    expect(data.deliveryDescription).toContain("No phone number is needed");
    expect(demoService("data-airtel-1gb", "gb")).toBeNull();
  });

  it("fails closed for an unsupported category instead of inventing a generic checkout", () => {
    const selection = demoService("verification-whatsapp", "ng")!;
    expect(demoServicePresentation({ ...selection, item: { ...selection.item, category: "accounts" } })).toBeNull();
  });
});
