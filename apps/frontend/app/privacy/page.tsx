import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Story Poker",
  description: "How Story Poker handles room and usage data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8 sm:py-14">
      <article className="space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-muted-foreground">
            This policy explains how Story Poker handles information when you
            use the service.
          </p>
        </header>

        <section className="space-y-2" aria-labelledby="information-used">
          <h2 id="information-used" className="text-xl font-semibold">
            Information used
          </h2>
          <p className="leading-7 text-muted-foreground">
            The service processes the display name, room content, votes, and
            settings you submit so participants can collaborate. You do not need
            to create an account.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="storage-retention">
          <h2 id="storage-retention" className="text-xl font-semibold">
            Storage and retention
          </h2>
          <p className="leading-7 text-muted-foreground">
            Active room data is held temporarily by the service. Session
            credentials, preferences, and retrospective history may be stored in
            your browser so you can reconnect or revisit your work. You can
            remove browser-stored data through your browser settings.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="analytics">
          <h2 id="analytics" className="text-xl font-semibold">
            Analytics and service providers
          </h2>
          <p className="leading-7 text-muted-foreground">
            Story Poker uses hosting infrastructure and privacy-focused usage
            analytics to operate and improve the service. Those providers may
            process technical information such as request and device data on our
            behalf.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="sharing">
          <h2 id="sharing" className="text-xl font-semibold">
            Sharing
          </h2>
          <p className="leading-7 text-muted-foreground">
            Room content is shared with participants in that room. Do not enter
            sensitive personal information. Story Poker does not sell your
            personal information.
          </p>
        </section>
      </article>
    </main>
  );
}
