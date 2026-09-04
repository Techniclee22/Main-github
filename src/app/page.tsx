import { Hero } from "@/components/Hero";
import { ReaderApp } from "@/components/ReaderApp";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#reader">
        Skip to reader
      </a>
      <div className="page">
        <Hero />
        <div id="reader">
          <ReaderApp />
        </div>

        <section className="roadmap" aria-labelledby="roadmap-heading">
          <h2 id="roadmap-heading">Where this is going</h2>
          <p>
            This foundation is built so we can grow into a full assistive reader
            across phones, tablets, and computers.
          </p>
          <ol>
            <li>
              <strong>Now:</strong> camera / photo OCR and type-or-paste, with
              on-device voices and a natural-voice path.
            </li>
            <li>
              <strong>Next:</strong> richer voice library, continuous listening,
              bookmarks, and better reading order for complex layouts.
            </li>
            <li>
              <strong>Later:</strong> screen capture / share targets, browser
              extension, and deeper OS accessibility integrations.
            </li>
          </ol>
        </section>

        <footer className="site-footer">
          Read to Me — built for people who need the world spoken aloud.
        </footer>
      </div>
    </>
  );
}
