// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { esimQrDataUrl } from "@/lib/esim-qr";
import { EsimProfile } from "@/app/dashboard/orders/[id]/EsimProfile";

/**
 * The email told the customer to open the order page for the QR code, and the
 * order page only ever showed the activation string. Scanning is the install;
 * typing a 60-character `LPA:1$…` credential is the fallback nobody wants.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ACTIVATION = "LPA:1$rsp.truphone.com$ABC123-4567-89AB-CDEF";

afterEach(cleanup);

describe("esimQrDataUrl", () => {
  it("draws the activation string as a PNG data URL, so no request leaves the page", async () => {
    const url = await esimQrDataUrl(ACTIVATION);
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect((url as string).length).toBeGreaterThan(100);
  });

  it("refuses an empty or oversized payload rather than rendering a code that cannot scan", async () => {
    expect(await esimQrDataUrl("   ")).toBeNull();
    expect(await esimQrDataUrl("LPA:1$" + "x".repeat(2_000))).toBeNull();
  });
});

describe("EsimProfile", () => {
  const base = {
    orderId: "0b6f7f1e-1f0a-4a4f-9d1a-6b2f4a8c0d11",
    activationCode: ACTIVATION,
    installUrl: null,
    iccid: null,
    pending: false,
  };

  it("shows the QR when the page could draw one", async () => {
    const qrDataUrl = await esimQrDataUrl(ACTIVATION);
    render(<EsimProfile {...base} qrDataUrl={qrDataUrl} />);
    const image = screen.getByAltText("eSIM installation QR code") as HTMLImageElement;
    expect(image.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByText(/Point your phone's camera at this code/)).toBeTruthy();
  });

  it("still shows the code and the manual steps when no QR could be drawn", () => {
    render(<EsimProfile {...base} qrDataUrl={null} />);
    expect(screen.queryByAltText("eSIM installation QR code")).toBeNull();
    expect(screen.getByText(ACTIVATION)).toBeTruthy();
    expect(screen.getByText(/Enter details manually/)).toBeTruthy();
  });

  it("offers the QR install as step one, not as an alternative to the code", async () => {
    const qrDataUrl = await esimQrDataUrl(ACTIVATION);
    render(<EsimProfile {...base} qrDataUrl={qrDataUrl} />);
    const steps = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(steps[0]).toContain("Scan the QR");
    expect(steps.join(" ")).toContain("Enter details manually");
  });
});
