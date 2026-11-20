import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps same-origin relative paths (with query and hash)", () => {
    expect(safeRedirectPath("/devices?brand=1&min=2#top")).toBe("/devices?brand=1&min=2#top");
    expect(safeRedirectPath("/reset-password?mode=invite")).toBe("/reset-password?mode=invite");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\n/evil.com",
    "https://evil.com",
    "http:/evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    "%2F%2Fevil.com",
  ])("rejects %j", (value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });

  it("rejects non-strings and uses the fallback", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined, "/login")).toBe("/login");
  });
});
