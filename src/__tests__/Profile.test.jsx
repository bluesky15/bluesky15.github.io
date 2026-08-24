// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Profile from "../components/Profile.jsx";

const flags = { blogs: true, login: true, resume: true, themeToggle: true };

const fullProfile = {
  name: "Test Person",
  role: "Engineer",
  tagline: "Building things.",
  about: ["Paragraph one.", "Paragraph two."],
  skills: [
    { category: "Languages", items: ["Kotlin", "Rust"] },
    { category: "Tools", items: ["Git"] },
  ],
  experience: [
    {
      period: "Jan 2025 — Present",
      title: "Tech Lead",
      company: "Acme",
      summary: "Leading a team.",
    },
  ],
  projects: [
    { name: "Project A", description: "Desc A", tech: ["Kotlin"], link: "" },
    { name: "Project B", description: "Desc B", tech: ["Rust"], link: "https://example.com" },
  ],
  contact: {
    email: "me@example.com",
    github: "https://github.com/someone",
    linkedin: "https://linkedin.com/in/someone",
  },
};

afterEach(cleanup);

describe("Profile loading and error states", () => {
  it("shows a message when profile is null", () => {
    render(<Profile profile={null} failed={false} flags={flags} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows an error message when failed", () => {
    render(<Profile profile={null} failed={true} flags={flags} />);
    expect(screen.getByText(/Could not load the profile/)).toBeTruthy();
  });
});

describe("Profile content rendering", () => {
  it("renders name, tagline and about paragraphs", () => {
    render(<Profile profile={fullProfile} failed={false} flags={flags} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Test Person");
    expect(screen.getByText(fullProfile.tagline)).toBeTruthy();
    expect(screen.getByText("Paragraph one.")).toBeTruthy();
    expect(screen.getByText("Paragraph two.")).toBeTruthy();
  });

  it("renders every skill category with its chips", () => {
    render(<Profile profile={fullProfile} failed={false} flags={flags} />);
    expect(screen.getByText("Languages")).toBeTruthy();
    expect(screen.getAllByText("Kotlin").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Tools")).toBeTruthy();
  });

  it("renders experience entries with period, title and company", () => {
    render(<Profile profile={fullProfile} failed={false} flags={flags} />);
    expect(screen.getByText(/Tech Lead/)).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("Jan 2025 — Present")).toBeTruthy();
  });

  it("renders projects; external-link icon only when project.link exists", () => {
    render(<Profile profile={fullProfile} failed={false} flags={flags} />);
    expect(screen.getByText("Project A")).toBeTruthy();
    expect(screen.getByText("Project B")).toBeTruthy();
    const external = screen.getAllByRole("link", { name: /on GitHub/i });
    expect(external).toHaveLength(1);
    expect(external[0].getAttribute("href")).toBe("https://example.com");
  });
});

describe("Profile flag gating", () => {
  it("shows the hero Resume button when enabled", () => {
    render(<Profile profile={fullProfile} failed={false} flags={flags} />);
    expect(screen.getByText("Resume ↓").closest("a").getAttribute("href")).toBe("/resume.pdf");
  });

  it("hides the hero Resume button when resume flag is off", () => {
    render(
      <Profile profile={fullProfile} failed={false} flags={{ ...flags, resume: false }} />
    );
    expect(screen.queryByText("Resume ↓")).toBeNull();
  });
});

describe("Profile social links", () => {
  it("renders github and linkedin icons in hero and contact sections", () => {
    render(<Profile profile={fullProfile} failed={false} flags={flags} />);
    const github = screen.getAllByLabelText("GitHub");
    const linkedin = screen.getAllByLabelText("LinkedIn");
    expect(github.length).toBe(2);
    expect(linkedin.length).toBe(2);
    for (const link of [...github, ...linkedin]) {
      expect(link.getAttribute("target")).toBe("_blank");
    }
    expect(github[0].getAttribute("href")).toBe(fullProfile.contact.github);
    expect(linkedin[1].getAttribute("href")).toBe(fullProfile.contact.linkedin);
  });

  it("omits social icons when contact urls are empty", () => {
    const p = {
      ...fullProfile,
      contact: { email: "x@y.com", github: "", linkedin: "" },
    };
    render(<Profile profile={p} failed={false} flags={flags} />);
    expect(screen.queryByLabelText("GitHub")).toBeNull();
    expect(screen.queryByLabelText("LinkedIn")).toBeNull();
    expect(screen.getByText("Say Hello")).toBeTruthy();
  });
});
