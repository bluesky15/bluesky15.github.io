function FolderIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

function LinkedinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.55V9h3.57v11.45z" />
    </svg>
  );
}

export default function Profile({ profile, failed }) {
  if (failed) {
    return (
      <main id="content" className="container">
        <p className="state">Could not load the profile. Please try again later.</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main id="content" className="container">
        <p className="state">Loading…</p>
      </main>
    );
  }

  const { email, github, linkedin } = profile.contact;
  const resumeUrl = "/resume.pdf";

  return (
    <>
      {(github || linkedin) && (
        <div className="side side-left">
          <ul>
            {github && (
              <li>
                <a href={github} target="_blank" rel="noreferrer">
                  github
                </a>
              </li>
            )}
            {linkedin && (
              <li>
                <a href={linkedin} target="_blank" rel="noreferrer">
                  linkedin
                </a>
              </li>
            )}
          </ul>
          <span className="side-line" />
        </div>
      )}

      {email && (
        <div className="side side-right">
          <a className="side-email" href={`mailto:${email}`}>
            {email}
          </a>
          <span className="side-line" />
        </div>
      )}

      <main id="content" className="container counter-sections">
        <section className="hero" id="top">
          <p className="eyebrow">Hi, my name is</p>
          <h1>{profile.name}.</h1>
          <p className="hero-line">I architect mobile products end to end.</p>
          <p className="tagline">{profile.tagline}</p>
          <div className="hero-actions">
            <a className="btn btn-fill" href={resumeUrl} target="_blank" rel="noopener noreferrer">
              Resume ↓
            </a>
            {email && (
              <a className="btn" href={`mailto:${email}`}>
                Get In Touch
              </a>
            )}
            <a className="btn" href="#projects">
              See My Work
            </a>
            {github && (
              <a className="icon-link" href={github} target="_blank" rel="noreferrer" aria-label="GitHub">
                <GithubIcon />
              </a>
            )}
            {linkedin && (
              <a className="icon-link" href={linkedin} target="_blank" rel="noreferrer" aria-label="LinkedIn">
                <LinkedinIcon />
              </a>
            )}
          </div>
        </section>

        <section id="about">
          <h2 className="numbered">About Me</h2>
          <div className="prose">
            {profile.about.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </section>

        <section id="skills">
          <h2 className="numbered">Skills &amp; Technologies</h2>
          <div className="skill-grid">
            {profile.skills.map((group) => (
              <article className="card" key={group.category}>
                <h3>{group.category}</h3>
                <ul className="chips">
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="experience">
          <h2 className="numbered">Where I've Worked</h2>
          <ol className="timeline">
            {profile.experience.map((job) => (
              <li className="timeline-item" key={`${job.period}-${job.title}`}>
                <p className="period">{job.period}</p>
                <h3>
                  {job.title} · <span className="muted">{job.company}</span>
                </h3>
                <p>{job.summary}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="projects">
          <h2 className="numbered">Some Things I've Built</h2>
          <div className="project-grid">
            {profile.projects.map((project) => (
              <article className="card project" key={project.name}>
                <div className="project-header">
                  <FolderIcon />
                  {project.link && (
                    <span className="project-links">
                      <a href={project.link} target="_blank" rel="noreferrer" aria-label={`${project.name} on GitHub`}>
                        <ExternalIcon />
                      </a>
                    </span>
                  )}
                </div>
                <h3>{project.name}</h3>
                <p className="desc">{project.description}</p>
                <ul className="chips">
                  {project.tech.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="contact-card" id="contact">
          <h2 className="numbered">What's Next?</h2>
          <p className="contact-big">Let's Build Something Together</p>
          <p className="contact-blurb">
            I'm open to new opportunities and interesting problems. Whether you have a question or just want to say hi, my inbox is always open.
          </p>
          <div className="contact-links">
            {email && (
              <a className="btn" href={`mailto:${email}`}>
                Say Hello
              </a>
            )}
            {github && (
              <a className="icon-link" href={github} target="_blank" rel="noreferrer" aria-label="GitHub">
                <GithubIcon />
              </a>
            )}
            {linkedin && (
              <a className="icon-link" href={linkedin} target="_blank" rel="noreferrer" aria-label="LinkedIn">
                <LinkedinIcon />
              </a>
            )}
          </div>
        </section>

        <footer className="footer">
          © {new Date().getFullYear()} {profile.name} · Designed &amp; built with{" "}
          <a href="https://go.dev" target="_blank" rel="noreferrer">
            Go
          </a>{" "}
          +{" "}
          <a href="https://react.dev" target="_blank" rel="noreferrer">
            React
          </a>
        </footer>
      </main>
    </>
  );
}
