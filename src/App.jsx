import { useEffect, useState } from "react";
import Nav from "./components/Nav.jsx";
import Profile from "./components/Profile.jsx";
import Blogs from "./components/Blogs.jsx";

export default function App() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === "retro" ? "retro" : "modern"
  );
  const [view, setView] = useState("home");
  const [profile, setProfile] = useState(null);
  const [profileFailed, setProfileFailed] = useState(false);

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

  return (
    <>
      <a className="skip-to-content" href="#about">
        Skip to Content
      </a>
      <Nav theme={theme} setTheme={setTheme} view={view} onNavigate={navigate} />
      {view === "blogs" ? (
        <Blogs onBack={() => navigate("about")} />
      ) : (
        <Profile profile={profile} failed={profileFailed} />
      )}
    </>
  );
}
