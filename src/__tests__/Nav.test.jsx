// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Nav from "../components/Nav.jsx";

const baseFlags = { blogs: true, login: true, resume: true, themeToggle: true };
const nav = (flags) =>
  render(
    <Nav
      theme="modern"
      setTheme={() => {}}
      view="home"
      onNavigate={() => {}}
      flags={flags}
    />
  );

afterEach(cleanup);

describe("Nav section links", () => {
  it("renders all sections plus Blogs when blogs flag is on", () => {
    nav({ ...baseFlags });
    for (const label of ["About", "Skills", "Experience", "Projects", "Blogs"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("hides the Blogs link when the blogs flag is off", () => {
    nav({ ...baseFlags, blogs: false });
    expect(screen.queryByText("Blogs")).toBeNull();
    expect(screen.getByText("About")).toBeTruthy();
    expect(screen.getByText("Projects")).toBeTruthy();
  });

  it("numbers remaining sections correctly after filtering", () => {
    nav({ ...baseFlags, blogs: false });
    const nums = screen.getAllByText(/^0\d\.$/).map((el) => el.textContent);
    expect(nums).toEqual(["01.", "02.", "03.", "04."]);
  });
});

describe("Nav resume cta", () => {
  it("shows the Resume link when enabled", () => {
    nav({ ...baseFlags });
    const link = screen.getByText("Resume").closest("a");
    expect(link.getAttribute("href")).toBe("/resume.pdf");
  });

  it("hides the Resume link when disabled", () => {
    nav({ ...baseFlags, resume: false });
    expect(screen.queryByText("Resume")).toBeNull();
  });
});

describe("Nav login button", () => {
  it("shows login when enabled", () => {
    nav({ ...baseFlags });
    expect(screen.getByText("login")).toBeTruthy();
  });

  it("hides login when disabled", () => {
    nav({ ...baseFlags, login: false });
    expect(screen.queryByText("login")).toBeNull();
  });
});

describe("Nav theme toggle", () => {
  it("shows the toggle and calls setTheme on click", () => {
    let toggled = false;
    render(
      <Nav
        theme="modern"
        setTheme={(fn) => {
          toggled = fn("modern") === "retro";
        }}
        view="home"
        onNavigate={() => {}}
        flags={{ ...baseFlags }}
      />
    );
    fireEvent.click(screen.getByText("retro_crt"));
    expect(toggled).toBe(true);
  });

  it("hides the toggle when disabled", () => {
    nav({ ...baseFlags, themeToggle: false });
    expect(screen.queryByText("retro_crt")).toBeNull();
  });
});
