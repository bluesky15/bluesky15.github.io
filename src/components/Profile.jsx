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
