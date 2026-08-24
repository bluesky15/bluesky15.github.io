import { useEffect, useState } from "react";
import Nav from "./components/Nav.jsx";
import Profile from "./components/Profile.jsx";
import Blogs from "./components/Blogs.jsx";

const DEFAULT_FLAGS = { blogs: true, login: true, resume: true, themeToggle: true };

export default function App() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === "retro" ? "retro" : "modern"
  );
  const [view, setView] = useState("home");
  const [profile, setProfile] = useState(null);
  const [profileFailed, setProfileFailed] = useState(false);
  const [flags, setFlags] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = `${import.meta.env.BASE_URL}wasm_exec.js`;
          s.onload = resolve;
          s.onerror = () => reject(new Error("wasm_exec.js failed to load"));
          document.head.appendChild(s);
        });
        const go = new window.Go();
        const bytes = await (
          await fetch(`${import.meta.env.BASE_URL}data/flags.wasm`)
        ).arrayBuffer();
        const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
        go.run(instance);
        let waited = 0;
        while (!window.__getFlags && waited < 5000) {
          await new Promise((r) => setTimeout(r, 10));
          waited += 10;
        }
        if (!window.__getFlags) throw new Error("__getFlags not registered");
        const data = JSON.parse(window.__getFlags());
        if (!cancelled) setFlags({ ...DEFAULT_FLAGS, ...data });
      } catch {
        if (!cancelled) setFlags(DEFAULT_FLAGS);
      }
    };
    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/profile.json`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      })
      .then(setProfile)
      .catch(() => setProfileFailed(true));
  }, []);

  useEffect(() => {
    if (theme === "retro") {
      document.documentElement.dataset.theme = "retro";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem("theme", theme);
    } catch {
      return;
    }
  }, [theme]);

  const navigate = (id) => {
    if (id === "blogs" && !flags?.blogs) return;
    if (id === "blogs") {
      setView("blogs");
      setTimeout(() => window.scrollTo({ top: 0 }), 0);
      return;
    }
    setView("home");
    setTimeout(() => {
      if (id === "top") {
        window.scrollTo({ top: 0 });
        return;
      }
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }, 0);
  };

  if (!flags) return null;

  return (
    <>
      <a className="skip-to-content" href="#about">
        Skip to Content
      </a>
      <Nav theme={theme} setTheme={setTheme} view={view} onNavigate={navigate} flags={flags} />
      {view === "blogs" ? (
        <Blogs onBack={() => navigate("about")} />
      ) : (
        <Profile profile={profile} failed={profileFailed} flags={flags} />
      )}
    </>
  );
}
