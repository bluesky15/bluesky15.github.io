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
        const bytes = await (
          await fetch(`${import.meta.env.BASE_URL}data/flags.wasm`)
        ).arrayBuffer();
        const { instance } = await WebAssembly.instantiate(bytes);
        const e = instance.exports;
        const json = new TextDecoder().decode(
          new Uint8Array(e.memory.buffer, e.get_flags_ptr(), e.get_flags_len())
        );
        if (!cancelled) setFlags({ ...DEFAULT_FLAGS, ...JSON.parse(json) });
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
