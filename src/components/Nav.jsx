import { useState } from "react";
import { createPortal } from "react-dom";

export default function Nav({ theme, setTheme, view, onNavigate }) {
  const [loginOpen, setLoginOpen] = useState(false);
  const [user, setUser] = useState(null);

  const sectionLinks = [
    ["about", "About"],
    ["skills", "Skills"],
    ["experience", "Experience"],
    ["projects", "Projects"],
    ["blogs", "Blogs"],
  ];

  const handleClick = (e, id) => {
    e.preventDefault();
    onNavigate(id);
  };

  return (
    <header className="nav">
      <div className="container nav-inner">
        <a
          href="#top"
          className="logo"
          aria-label="Home"
          onClick={(e) => handleClick(e, "top")}
        >
          L
        </a>
        <nav className="nav-links" aria-label="Primary">
          {sectionLinks.map(([id, label], i) => {
            const num = i === 4 ? "" : `0${i + 1}.`;
            return (
              <a
                key={id}
                href={view === id ? "#" : `#${id}`}
                className={view === id ? "active" : ""}
                onClick={(e) => handleClick(e, id)}
              >
                {num && <span className="nav-num">{num}</span>}
                {label}
              </a>
            );
          })}
          <a
            href="/resume.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-cta"
          >
            Resume
          </a>
          {user ? (
            <button type="button" className="theme-toggle" onClick={() => setUser(null)}>
              logout ({user})
            </button>
          ) : (
            <button type="button" className="theme-toggle" onClick={() => setLoginOpen(true)}>
              login
            </button>
          )}
          <button
            type="button"
            className="theme-toggle"
            aria-pressed={theme === "retro"}
            title="Toggle theme"
            onClick={() => setTheme((t) => (t === "retro" ? "modern" : "retro"))}
          >
            {theme === "retro" ? "modern_ui" : "retro_crt"}
          </button>
        </nav>

        {loginOpen &&
          createPortal(
            <div
              className="modal-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) setLoginOpen(false);
              }}
            >
              <div className="modal" role="dialog" aria-modal="true" aria-label="Login">
              <h3>Log in</h3>
              <p>Demo login — any email and password works.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.target);
                  const email = String(data.get("email") || "").trim();
                  if (!email) return;
                  setUser(email.split("@")[0]);
                  setLoginOpen(false);
                }}
              >
                <label className="field">
                  Email
                  <input name="email" type="email" required placeholder="you@example.com" />
                </label>
                <label className="field">
                  Password
                  <input name="password" type="password" required placeholder="••••••••" />
                </label>
                <button type="submit" className="btn btn-fill modal-submit">
                  Log In
                </button>
              </form>
              <button type="button" className="modal-close" onClick={() => setLoginOpen(false)} aria-label="Close">
                ×
              </button>
              </div>
            </div>,
            document.body
          )}
      </div>
    </header>
  );
}
