import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthForm } from "@/components/auth/AuthForm";

const html = renderToStaticMarkup(<AuthForm mode="login" next="/dashboard" />);
const source = readFileSync(
  fileURLToPath(new URL("../components/auth/AuthForm.tsx", import.meta.url)),
  "utf8",
);

describe("one-click demo login", () => {
  it("posts to the server route so it still works without JavaScript", () => {
    expect(html).toContain('action="/api/auth/demo-web"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="next"');
    expect(html).toContain('value="/dashboard"');
  });

  it("does not disable its own submit button on click", () => {
    // A submit button that becomes `disabled` inside its own click handler is
    // removed before the browser performs the default form submission, so the
    // form never posts and the visitor is stuck on "Opening the demo…".
    const demoButton = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*One-Click Demo Login/);
    expect(demoButton, "demo button should exist").not.toBeNull();
    expect(demoButton?.[0]).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("still reads as a demo and says what it gives you", () => {
    expect(html).toContain("One-Click Demo Login");
    expect(html).toContain("Demo starts signed in with ₦25,000 wallet credit");
  });

  it("never intercepts the submit with a client-side request", () => {
    // The demo used to be onSubmit + fetch("/api/auth/demo") + window.location.
    // When the fetch resolved but the navigation didn't, the button stayed on
    // "Opening the demo…" forever. The form must remain a plain browser POST.
    expect(source).not.toContain('fetch("/api/auth/demo"');
    expect(source).not.toContain("submitDemo");
    expect(source).toContain('action="/api/auth/demo-web"');
    expect(source).toContain('method="post"');
  });

  it("offers a plain-link fallback if the button ever does nothing", () => {
    expect(html).toContain("Button not responding? Open the demo directly");
    expect(html).toContain("/api/auth/demo-web?next=%2Fdashboard");
  });
});

describe("login page resilience to a stale client bundle", () => {
  const loginPageSource = readFileSync(
    fileURLToPath(new URL("../app/(auth)/login/page.tsx", import.meta.url)),
    "utf8",
  );

  it("keeps request-dependent notices out of the client AuthForm", () => {
    // A browser holding an older AuthForm bundle cannot render nodes added to
    // that component later: the server includes them, the client does not, and
    // React reports a hydration mismatch. The "landed back here" notice caused
    // exactly that, so it now lives in the server page.
    expect(source).not.toContain("bounced");
    expect(source).not.toContain("Just signed in and landed back here");
  });

  it("renders the bounce notice from the server page instead", () => {
    expect(loginPageSource).toContain("function BounceNotice");
    expect(loginPageSource).toContain('bounced === "1"');
    expect(loginPageSource).toContain("/api/auth/whoami");
  });

  it("passes AuthForm the same three props it has always taken", () => {
    expect(loginPageSource).toMatch(
      /<AuthForm\s+mode="login"\s+next=\{safeNext\}\s+errorParam=\{error \?\? null\}\s*\/>/,
    );
  });
});
