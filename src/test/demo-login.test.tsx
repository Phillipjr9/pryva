import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthForm } from "@/components/auth/AuthForm";

const html = renderToStaticMarkup(<AuthForm mode="login" next="/dashboard" />);

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
});
